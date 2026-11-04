<?php

namespace App\Services\Pdf;

use Illuminate\Support\Facades\Storage;

/**
 * Maps public storage URLs to local files (no HTTP round trip, no SSRF) and
 * downscales large images into a temp dir so the PDF stays small.
 */
class PdfImageResolver
{
    private array $cache = [];

    public function __construct(private string $workDir) {}

    /** Local file URL for a stored path ("products/1/x.png"), or null if missing/unreadable. */
    public function forStoragePath(string $path): ?string
    {
        $path = ltrim($path, '/');
        if (str_contains($path, '..')) {
            return null;
        }
        $abs = Storage::disk('public')->path($path);
        if (! is_file($abs)) {
            return null;
        }

        return $this->cache[$abs] ??= 'file://'.$this->shrink($abs);
    }

    /** Resolve an <img src> that points at our own /storage URL; anything else is refused. */
    public function forUrl(string $src): ?string
    {
        $prefix = rtrim(Storage::disk('public')->url(''), '/').'/';
        if (! str_starts_with($src, $prefix)) {
            return null;
        }

        return $this->forStoragePath(rawurldecode(substr($src, strlen($prefix))));
    }

    private function shrink(string $abs): string
    {
        $info = @getimagesize($abs);
        $max = (int) config('pdf.max_image_width');
        // Skip downscaling for tiny images and for anything so large that decoding it could exhaust memory.
        if (! $info || $info[0] <= $max || $info[0] * $info[1] > 40_000_000 || ! function_exists('imagecreatefromstring')) {
            return $abs;
        }

        $src = @imagecreatefromstring((string) file_get_contents($abs));
        if (! $src) {
            return $abs;
        }
        $h = (int) round($info[1] * $max / $info[0]);
        $dst = imagecreatetruecolor($max, $h);
        imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $max, $h, $info[0], $info[1]);

        $dir = $this->workDir.'/img';
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $out = $dir.'/'.md5($abs).'.jpg';
        imagejpeg($dst, $out, 82);
        imagedestroy($src);
        imagedestroy($dst);

        return $out;
    }
}
