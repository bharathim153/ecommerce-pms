<?php

namespace App\Services;

use HTMLPurifier;
use HTMLPurifier_Config;

/** Whitelist sanitiser for rich-text (TipTap) HTML. Strips scripts, event handlers, js: URLs. */
class HtmlSanitizer
{
    private ?HTMLPurifier $purifier = null;
    private ?HTMLPurifier $emailPurifier = null;

    public function clean(?string $html): ?string
    {
        if ($html === null || trim($html) === '') {
            return null;
        }

        return $this->purifier()->purify($html);
    }

    /** Looser profile for email bodies: inline styling is how HTML email works. Still no scripts/handlers/js: URLs. */
    public function cleanEmail(?string $html): string
    {
        if ($html === null || trim($html) === '') {
            return '';
        }
        if (! $this->emailPurifier) {
            $cacheDir = storage_path('framework/cache/purifier');
            if (! is_dir($cacheDir)) {
                mkdir($cacheDir, 0775, true);
            }
            $c = HTMLPurifier_Config::createDefault();
            $c->set('Cache.SerializerPath', $cacheDir);
            $c->set('Core.Encoding', 'UTF-8');
            $c->set('HTML.Doctype', 'HTML 4.01 Transitional');
            $c->set('HTML.Allowed', implode(',', [
                'p[style|align]', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span[style]', 'div[style|align]', 'center', 'blockquote[style]', 'hr[style]',
                'h1[style|align]', 'h2[style|align]', 'h3[style|align]', 'h4[style|align]', 'ul[style]', 'ol[style|start]', 'li[style]',
                'a[href|target|rel|title|style]', 'img[src|alt|title|width|height|style|align]',
                'table[style|width|border|cellpadding|cellspacing|align|bgcolor]', 'thead', 'tbody', 'tfoot', 'colgroup', 'col[span|width]', 'tr[style|bgcolor]',
                'th[colspan|rowspan|style|width|align|valign|bgcolor]', 'td[colspan|rowspan|style|width|align|valign|bgcolor]',
            ]));
            $c->set('CSS.AllowedProperties', [
                'color', 'background-color', 'background', 'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'text-align', 'text-decoration',
                'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
                'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-collapse', 'border-color', 'width', 'max-width', 'height', 'vertical-align',
            ]);
            $c->set('CSS.AllowTricky', true);
            $c->set('URI.AllowedSchemes', ['http' => true, 'https' => true, 'mailto' => true]);
            $c->set('Attr.AllowedFrameTargets', ['_blank']);
            $c->set('HTML.TargetNoopener', true);
            $c->set('HTML.TargetNoreferrer', true);
            $c->set('AutoFormat.RemoveEmpty', false);
            $this->emailPurifier = new HTMLPurifier($c);
        }

        return $this->emailPurifier->purify($html);
    }

    private function purifier(): HTMLPurifier
    {
        if ($this->purifier) {
            return $this->purifier;
        }

        $cacheDir = storage_path('framework/cache/purifier');
        if (! is_dir($cacheDir)) {
            mkdir($cacheDir, 0775, true);
        }

        $c = HTMLPurifier_Config::createDefault();
        $c->set('Cache.SerializerPath', $cacheDir);
        $c->set('Core.Encoding', 'UTF-8');
        $c->set('HTML.Doctype', 'HTML 4.01 Transitional');
        $c->set('HTML.Allowed', implode(',', [
            'p[style]', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span[style]', 'blockquote', 'hr',
            'h1[style]', 'h2[style]', 'h3[style]', 'h4[style]',
            'ul', 'ol[start]', 'li',
            'a[href|target|rel|title]',
            'img[src|alt|title|width|height|style]',
            'table[style]', 'thead', 'tbody', 'tfoot', 'colgroup', 'col[span|width]', 'tr',
            'th[colspan|rowspan|style]', 'td[colspan|rowspan|style]',
        ]));
        $c->set('CSS.AllowedProperties', ['text-align', 'width', 'height', 'min-width', 'max-width']);
        $c->set('URI.AllowedSchemes', ['http' => true, 'https' => true, 'mailto' => true]);
        $c->set('Attr.AllowedFrameTargets', ['_blank']);
        $c->set('Attr.AllowedRel', ['nofollow', 'noopener', 'noreferrer']);
        $c->set('HTML.TargetNoopener', true);
        $c->set('HTML.TargetNoreferrer', true);
        $c->set('AutoFormat.RemoveEmpty', false);

        return $this->purifier = new HTMLPurifier($c);
    }
}
