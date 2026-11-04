<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\EmailTemplate;
use App\Services\Campaigns\CampaignRenderer;
use App\Services\HtmlSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmailTemplateController extends Controller
{
    public function __construct(private HtmlSanitizer $sanitizer, private CampaignRenderer $renderer) {}

    public function index(Request $request): JsonResponse
    {
        $page = EmailTemplate::query()
            ->when($request->query('search'), fn ($q, $s) => $q->where('name', 'like', '%'.addcslashes($s, '%_\\').'%'))
            ->latest('id')->paginate(min((int) $request->query('per_page', 20), 100));

        return $this->ok(['items' => $page->items(), 'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()]]);
    }

    public function show(EmailTemplate $template): JsonResponse
    {
        return $this->ok($template);
    }

    public function store(Request $request): JsonResponse
    {
        return $this->ok(EmailTemplate::create($this->data($request)), 'Template created.', 201);
    }

    public function update(Request $request, EmailTemplate $template): JsonResponse
    {
        $template->update($this->data($request));

        return $this->ok($template->fresh(), 'Template updated.');
    }

    public function destroy(EmailTemplate $template): JsonResponse
    {
        $template->delete(); // campaigns keep their own snapshot; template_id is nullOnDelete

        return $this->ok(null, 'Template deleted.');
    }

    /** Renders exactly what a recipient would get (sanitised, merge tags, compliance footer). */
    public function preview(Request $request): JsonResponse
    {
        $d = $request->validate(['subject' => ['nullable', 'string', 'max:255'], 'body_html' => ['required', 'string', 'max:500000']]);

        return $this->ok([
            'subject' => $this->renderer->renderSubject($d['subject'] ?? '', null),
            'html' => $this->renderer->render($this->sanitizer->cleanEmail($d['body_html']), null),
        ]);
    }

    private function data(Request $request): array
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'subject' => ['required', 'string', 'max:255'],
            'body_html' => ['required', 'string', 'max:500000'],
        ]);
        $d['body_html'] = $this->sanitizer->cleanEmail($d['body_html']);

        return $d;
    }
}
