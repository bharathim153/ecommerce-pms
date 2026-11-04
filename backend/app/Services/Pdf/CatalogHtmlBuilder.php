<?php

namespace App\Services\Pdf;

use Illuminate\Support\Collection;

class CatalogHtmlBuilder
{
    public function __construct(private PdfImageResolver $images) {}

    /**
     * @param  Collection<int, \App\Models\Product>  $products
     */
    public function build(Collection $products, int $pageOffset, ?array $cover = null): string
    {
        $items = $products->map(function ($p) {
            $gallery = $p->images->map(fn ($i) => [
                'src' => $this->images->forStoragePath($i->path),
                'alt' => $i->alt,
                'primary' => $i->is_primary,
            ])->filter(fn ($i) => $i['src'])->sortByDesc('primary')->values();

            return [
                'product' => $p,
                'hero' => $gallery->first(),
                'extra' => $gallery->slice(1, 5)->values(),
                'description' => $this->localiseDescription($p->description),
            ];
        });

        return view('pdf.catalog', [
            'items' => $items,
            'offset' => $pageOffset,
            'cover' => $cover,
            'generatedAt' => now()->format('M j, Y'),
            'brand' => config('app.name'),
        ])->render();
    }

    /** Keep only <img> that point at our own storage (rewritten to local files); drop all others. */
    private function localiseDescription(?string $html): string
    {
        if ($html === null || trim($html) === '') {
            return '';
        }
        if (stripos($html, '<img') === false) {
            return $html;
        }

        $doc = new \DOMDocument;
        libxml_use_internal_errors(true);
        $doc->loadHTML('<?xml encoding="utf-8"?><div id="root">'.$html.'</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
        libxml_clear_errors();

        foreach (iterator_to_array($doc->getElementsByTagName('img')) as $img) {
            $local = $this->images->forUrl($img->getAttribute('src'));
            if ($local) {
                $img->setAttribute('src', $local);
            } else {
                $img->parentNode?->removeChild($img);
            }
        }

        $root = $doc->getElementById('root');
        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $doc->saveHTML($child);
        }

        return $out;
    }
}
