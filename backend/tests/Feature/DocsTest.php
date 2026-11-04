<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/** Keeps docs/API.md honest: every live API route must have a row, and every row must be a live route. */
class DocsTest extends TestCase
{
    private function docs(): string
    {
        return file_get_contents(base_path('../docs/API.md'));
    }

    public function test_every_api_route_is_documented(): void
    {
        $docs = $this->docs();
        $missing = [];
        foreach (Route::getRoutes() as $r) {
            if (! str_starts_with($r->uri(), 'api/')) {
                continue;
            }
            $path = substr($r->uri(), 3); // "api/x" -> "/x"
            foreach (array_diff($r->methods(), ['HEAD', 'OPTIONS']) as $m) {
                if (! preg_match('/\|\s*`[A-Z\/\\\\|]*'.$m.'[A-Z\/\\\\|]*`\s*\|\s*`'.preg_quote($path, '/').'`\s*\|/', $docs)) {
                    $missing[] = "$m $path";
                }
            }
        }
        $this->assertSame([], $missing, "Undocumented routes:\n".implode("\n", $missing));
    }

    public function test_documented_routes_exist(): void
    {
        preg_match_all('/\|\s*`([A-Z\/]+)`\s*\|\s*`(\/[^`]+)`\s*\|/', $this->docs(), $rows, PREG_SET_ORDER);
        $live = [];
        foreach (Route::getRoutes() as $r) {
            foreach ($r->methods() as $m) {
                $live[$m.' '.substr($r->uri(), 3)] = true;
            }
        }
        $this->assertGreaterThan(70, count($rows), "sanity: the table was parsed");
        $ghosts = [];
        foreach ($rows as [, $methods, $path]) {
            foreach (explode('/', $methods) as $m) {
                if (! isset($live["$m $path"])) {
                    $ghosts[] = "$m $path";
                }
            }
        }
        $this->assertSame([], $ghosts, "Documented but not routed:\n".implode("\n", $ghosts));
    }
}
