<?php

namespace App\Jobs;

use App\Models\PdfExport;
use App\Models\Product;
use App\Services\Pdf\CatalogHtmlBuilder;
use App\Services\Pdf\ChromePdfRenderer;
use App\Services\Pdf\PdfImageResolver;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Builds a catalog PDF without holding it in memory:
 *   products -> chunks of N -> one Chrome render each -> part PDFs on disk -> pdfunite.
 * Parts that already exist are reused, so a retry resumes instead of starting over.
 */
class ProcessPdfExport implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;
    public array $backoff = [30, 120];
    public int $timeout;

    public function __construct(public int $exportId)
    {
        $this->timeout = (int) config('pdf.job_timeout');
    }

    public function handle(ChromePdfRenderer $renderer): void
    {
        $export = PdfExport::find($this->exportId);
        if (! $export || in_array($export->status, ['completed'], true)) {
            return;
        }

        $disk = Storage::disk(config('pdf.disk'));
        $dir = config('pdf.directory');
        $disk->makeDirectory($dir);
        $work = storage_path('app/pdf-work/'.$export->id);
        if (! is_dir($work)) {
            mkdir($work, 0775, true);
        }

        $ids = $this->productIds($export);
        if (! $ids) {
            throw new \RuntimeException('No products to export.');
        }

        $export->update([
            'status' => 'processing', 'error' => null, 'total_products' => count($ids),
            'processed_products' => 0, 'progress' => 0, 'started_at' => $export->started_at ?? now(),
        ]);

        $images = new PdfImageResolver($work);
        $builder = new CatalogHtmlBuilder($images);
        $chunks = array_chunk($ids, (int) config('pdf.chunk_size'));
        $parts = [];
        $offset = 0;
        $done = 0;

        foreach ($chunks as $n => $chunkIds) {
            $part = sprintf('%s/part-%05d.pdf', $work, $n);

            if (! is_file($part) || filesize($part) < 100) {
                $products = Product::with(['images', 'category'])->whereIn('id', $chunkIds)->get()
                    ->sortBy(fn ($p) => array_search($p->id, $chunkIds, true))->values();
                $html = $builder->build($products, $offset, $n === 0 ? ['count' => count($ids)] : null);
                $renderer->render($html, $part.'.tmp', $work);
                rename($part.'.tmp', $part); // atomic: a half-written part is never reused
                unset($products, $html);
            }

            $offset += $renderer->pageCount($part);
            $parts[] = $part;
            $done += count($chunkIds);
            // Rendering is ~95% of the work; the merge is the rest.
            $export->update(['processed_products' => $done, 'progress' => (int) floor($done / count($ids) * 95)]);
        }

        $final = $work.'/final.pdf';
        $renderer->merge($parts, $final, $work);

        $rel = $dir.'/export-'.$export->id.'.pdf';
        $disk->put($rel, fopen($final, 'rb')); // streamed copy
        $pages = $renderer->pageCount($disk->path($rel));

        $export->update([
            'status' => 'completed', 'progress' => 100, 'page_count' => $pages,
            'file_path' => $rel, 'finished_at' => now(),
        ]);

        $renderer->rmdir($work);
    }

    public function failed(Throwable $e): void
    {
        PdfExport::whereKey($this->exportId)->update([
            'status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 1000), 'finished_at' => now(),
        ]);
        (new ChromePdfRenderer)->rmdir(storage_path('app/pdf-work/'.$this->exportId));
    }

    /** @return int[] ordered by name so the catalog is alphabetical */
    private function productIds(PdfExport $export): array
    {
        $q = Product::query()->orderBy('name')->orderBy('id');
        if ($export->scope === 'selected') {
            $q->whereIn('id', $export->product_ids ?? []);
        }

        return $q->pluck('id')->all();
    }
}
