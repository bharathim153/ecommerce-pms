<?php

namespace App\Services\Pdf;

use RuntimeException;
use Symfony\Component\Process\Process;

class ChromePdfRenderer
{
    public function render(string $html, string $outPdf, string $workDir): void
    {
        $htmlFile = $workDir.'/'.pathinfo($outPdf, PATHINFO_FILENAME).'.html';
        $profile = $workDir.'/chrome-profile-'.getmypid();
        file_put_contents($htmlFile, $html);

        $process = new Process([
            config('pdf.chrome_binary'),
            '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
            '--disable-crash-reporter', '--disable-breakpad', '--no-zygote',
            '--disable-software-rasterizer', '--disable-extensions', '--disable-background-networking',
            '--no-first-run', '--no-default-browser-check',
            '--no-pdf-header-footer', '--hide-scrollbars',
            '--user-data-dir='.$profile,
            '--print-to-pdf='.$outPdf,
            'file://'.$htmlFile,
        ], null, [
            // Chromium writes crash/config data under $HOME; the web user's home may be read-only.
            'HOME' => $workDir,
            'XDG_CONFIG_HOME' => $workDir.'/.config',
            'XDG_CACHE_HOME' => $workDir.'/.cache',
        ], null, (float) config('pdf.chunk_timeout'));

        try {
            try {
                $process->run();
            } catch (\Symfony\Component\Process\Exception\ProcessSignaledException $e) {
                throw new RuntimeException('Chrome crashed ('.$e->getMessage().'): '.substr(trim($process->getErrorOutput()), -1500));
            }
        } finally {
            $this->rmdir($profile);
            @unlink($htmlFile);
        }

        if (! is_file($outPdf) || filesize($outPdf) < 100) {
            throw new RuntimeException('Chrome failed to produce a PDF: '.trim($process->getErrorOutput() ?: $process->getOutput()));
        }
    }

    public function pageCount(string $pdf): int
    {
        $p = new Process([config('pdf.info_binary'), $pdf]);
        $p->run();
        if (! $p->isSuccessful() || ! preg_match('/^Pages:\s+(\d+)/m', $p->getOutput(), $m)) {
            throw new RuntimeException('Cannot read PDF page count: '.$p->getErrorOutput());
        }

        return (int) $m[1];
    }

    /** Merge in batches so the argument list and open files stay small for huge exports. */
    public function merge(array $parts, string $out, string $workDir): void
    {
        $batchSize = 200;
        $level = 0;
        while (count($parts) > $batchSize) {
            $next = [];
            foreach (array_chunk($parts, $batchSize) as $i => $batch) {
                $tmp = "{$workDir}/merge-{$level}-{$i}.pdf";
                $this->uniteInto($batch, $tmp);
                $next[] = $tmp;
            }
            $parts = $next;
            $level++;
        }
        $this->uniteInto($parts, $out);
    }

    private function uniteInto(array $parts, string $out): void
    {
        if (count($parts) === 1) {
            copy($parts[0], $out);

            return;
        }
        $p = new Process([config('pdf.merge_binary'), ...$parts, $out], null, null, null, 1800);
        $p->run();
        if (! $p->isSuccessful() || ! is_file($out)) {
            throw new RuntimeException('PDF merge failed: '.trim($p->getErrorOutput()));
        }
    }

    public function rmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        $it = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($it as $f) {
            $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
        }
        @rmdir($dir);
    }
}
