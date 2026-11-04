<?php

namespace App\Console\Commands;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class DemoProducts extends Command
{
    protected $signature = 'pms:demo-products {count=50 : Number of products} {--purge : Delete previous demo products first}';
    protected $description = 'Generate demo products with long rich-text descriptions, tables and images (for PDF load testing)';

    public function handle(): int
    {
        if ($this->option('purge')) {
            foreach (Product::withTrashed()->where('sku', 'like', 'DEMO-%')->get() as $p) {
                $p->images()->delete();
                $p->forceDelete();
            }
            Storage::disk('public')->deleteDirectory('demo');
        }

        $cats = Category::pluck('id')->all();
        $files = $this->makeImages();
        $count = (int) $this->argument('count');
        $bar = $this->output->createProgressBar($count);
        $start = (int) Product::where('sku', 'like', 'DEMO-%')->count();

        for ($i = 1; $i <= $count; $i++) {
            $n = $start + $i;
            $p = Product::create([
                'category_id' => $cats ? $cats[array_rand($cats)] : null,
                'name' => sprintf('Demo Product %05d — %s', $n, ucfirst($this->words(3))),
                'slug' => 'demo-product-'.$n.'-'.Str::random(5),
                'sku' => sprintf('DEMO-%05d', $n),
                'price' => random_int(500, 90000) / 100,
                'stock' => random_int(0, 500),
                'status' => ['published', 'published', 'draft'][random_int(0, 2)],
                'short_description' => ucfirst($this->words(14)).'.',
                'description' => $this->description($n, $files),
            ]);
            foreach (array_rand($files, 2) as $k => $idx) {
                $p->images()->create(['path' => $files[$idx], 'alt' => 'Demo image', 'sort_order' => $k + 1, 'is_primary' => $k === 0]);
            }
            $bar->advance();
        }
        $bar->finish();
        $this->newLine();
        $this->info("Created {$count} demo products.");

        return self::SUCCESS;
    }

    private function words(int $n): string
    {
        static $pool = ['durable', 'premium', 'compact', 'lightweight', 'ergonomic', 'wireless', 'modular', 'efficient', 'portable', 'sturdy', 'precision', 'advanced', 'classic', 'versatile', 'reliable', 'smart', 'quiet', 'rapid', 'secure', 'flexible', 'design', 'battery', 'frame', 'surface', 'control', 'system', 'module', 'finish', 'panel', 'output'];
        $o = [];
        for ($i = 0; $i < $n; $i++) {
            $o[] = $pool[array_rand($pool)];
        }

        return implode(' ', $o);
    }

    private function description(int $n, array $files): string
    {
        $h = '<h2>Overview</h2>';
        for ($i = 0; $i < 4; $i++) {
            $h .= '<p>'.ucfirst($this->words(60)).'. <strong>'.$this->words(3).'</strong> '.$this->words(30).'.</p>';
        }
        $h .= '<h2>Highlights</h2><ul>';
        for ($i = 0; $i < 8; $i++) {
            $h .= '<li>'.ucfirst($this->words(8)).'</li>';
        }
        $h .= '</ul><p style="text-align:center"><img src="'.Storage::disk('public')->url($files[$n % count($files)]).'" width="360" alt="inline"></p>';
        $h .= '<h2>Specifications</h2><table><tbody><tr><th><p>Attribute</p></th><th><p>Value</p></th><th><p>Notes</p></th></tr>';
        for ($i = 0; $i < 26; $i++) {
            $h .= '<tr><td><p>'.ucfirst($this->words(2)).'</p></td><td><p>'.random_int(1, 999).' '.['mm', 'kg', 'W', 'V', 'Hz'][random_int(0, 4)].'</p></td><td><p>'.ucfirst($this->words(10)).'</p></td></tr>';
        }
        $h .= '</tbody></table><h3>Care instructions</h3><ol>';
        for ($i = 0; $i < 6; $i++) {
            $h .= '<li>'.ucfirst($this->words(12)).'</li>';
        }
        $h .= '</ol>';
        for ($i = 0; $i < 3; $i++) {
            $h .= '<h3>'.ucfirst($this->words(3)).'</h3><p>'.ucfirst($this->words(70)).'.</p>';
        }

        return $h;
    }

    /** Six distinct PNGs, large enough to exercise the downscaler. */
    private function makeImages(): array
    {
        $out = [];
        for ($k = 0; $k < 6; $k++) {
            $path = "demo/img-{$k}.png";
            if (! Storage::disk('public')->exists($path)) {
                $im = imagecreatetruecolor(1600, 1000);
                for ($y = 0; $y < 1000; $y += 10) {
                    imagefilledrectangle($im, 0, $y, 1600, $y + 10, imagecolorallocate($im, (60 + $k * 30 + $y / 8) % 255, (120 + $y / 6) % 255, (200 - $k * 25) % 255));
                }
                ob_start();
                imagepng($im);
                Storage::disk('public')->put($path, ob_get_clean());
            }
            $out[] = $path;
        }

        return $out;
    }
}
