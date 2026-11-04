<?php

namespace App\Mail;

use App\Services\Campaigns\CampaignRenderer;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Envelope;
use Symfony\Component\Mime\Email;

class CampaignMail extends Mailable
{
    public function __construct(
        public string $subjectLine,
        public string $htmlBody,
        public ?string $unsubscribeToken = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->subjectLine);
    }

    public function build(): static
    {
        $this->html($this->htmlBody);

        if ($this->unsubscribeToken) {
            $r = app(CampaignRenderer::class);
            $mailto = '<'.$r->oneClickUrl($this->unsubscribeToken).'>';
            $this->withSymfonyMessage(function (Email $m) use ($mailto) {
                $m->getHeaders()->addTextHeader('List-Unsubscribe', $mailto);
                $m->getHeaders()->addTextHeader('List-Unsubscribe-Post', 'List-Unsubscribe=One-Click');
                $m->getHeaders()->addTextHeader('Precedence', 'bulk');
            });
        }

        return $this;
    }
}
