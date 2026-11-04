<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Jobs\ProcessPdfExport;
use App\Models\PdfExport;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PdfExportController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $page = PdfExport::with('user:id,name')->latest('id')->paginate(min((int) $request->query('per_page', 15), 100));

        return $this->ok([
            'items' => collect($page->items())->map(fn ($e) => $this->row($e)),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'scope' => ['required', 'in:selected,all'],
            'product_ids' => ['required_if:scope,selected', 'array', 'min:1', 'max:5000'],
            'product_ids.*' => ['integer', 'distinct'],
        ]);

        $active = PdfExport::where('user_id', $request->user()->id)->whereIn('status', ['queued', 'processing'])->count();
        if ($active >= config('pdf.max_active_per_user')) {
            return $this->fail('You already have '.$active.' exports in progress. Wait for one to finish.', 429);
        }

        $ids = $data['scope'] === 'selected'
            ? Product::whereIn('id', $data['product_ids'])->pluck('id')->all()
            : null;

        if ($data['scope'] === 'selected' && ! $ids) {
            return $this->fail('None of the selected products exist.', 422);
        }
        if ($data['scope'] === 'all' && ! Product::exists()) {
            return $this->fail('There are no products to export.', 422);
        }

        $export = PdfExport::create([
            'user_id' => $request->user()->id,
            'scope' => $data['scope'],
            'product_ids' => $ids,
            'status' => 'queued',
            'total_products' => $ids ? count($ids) : Product::count(),
        ]);

        ProcessPdfExport::dispatch($export->id);

        return $this->ok($this->row($export->refresh()), 'Export queued.', 202);
    }

    public function show(PdfExport $pdfExport): JsonResponse
    {
        return $this->ok($this->row($pdfExport));
    }

    public function download(PdfExport $pdfExport): StreamedResponse|JsonResponse
    {
        $disk = Storage::disk(config('pdf.disk'));
        if ($pdfExport->status !== 'completed' || ! $pdfExport->file_path || ! $disk->exists($pdfExport->file_path)) {
            return $this->fail('This export is not available for download.', 409);
        }

        return $disk->download($pdfExport->file_path, 'products-'.$pdfExport->created_at->format('Ymd-His').'.pdf', ['Content-Type' => 'application/pdf']);
    }

    public function retry(PdfExport $pdfExport): JsonResponse
    {
        if ($pdfExport->status !== 'failed') {
            return $this->fail('Only failed exports can be retried.', 409);
        }
        $pdfExport->update(['status' => 'queued', 'error' => null, 'progress' => 0, 'processed_products' => 0, 'finished_at' => null]);
        ProcessPdfExport::dispatch($pdfExport->id);

        return $this->ok($this->row($pdfExport->fresh()), 'Export re-queued.', 202);
    }

    public function destroy(PdfExport $pdfExport): JsonResponse
    {
        if (in_array($pdfExport->status, ['queued', 'processing'], true)) {
            return $this->fail('Cannot delete an export that is still running.', 409);
        }
        if ($pdfExport->file_path) {
            Storage::disk(config('pdf.disk'))->delete($pdfExport->file_path);
        }
        $pdfExport->delete();

        return $this->ok(null, 'Export deleted.');
    }

    private function row(PdfExport $e): array
    {
        return [
            'id' => $e->id,
            'scope' => $e->scope,
            'status' => $e->status,
            'progress' => $e->progress,
            'total_products' => $e->total_products,
            'processed_products' => $e->processed_products,
            'page_count' => $e->page_count,
            'size_bytes' => $e->file_path && Storage::disk(config('pdf.disk'))->exists($e->file_path) ? Storage::disk(config('pdf.disk'))->size($e->file_path) : null,
            'error' => $e->error,
            'user' => $e->relationLoaded('user') ? $e->user?->name : null,
            'created_at' => $e->created_at,
            'started_at' => $e->started_at,
            'finished_at' => $e->finished_at,
        ];
    }
}
