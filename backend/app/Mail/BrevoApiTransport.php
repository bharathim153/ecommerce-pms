<?php

namespace App\Mail;

use Illuminate\Support\Facades\Http;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\MessageConverter;

/**
 * Sends mail through Brevo's HTTPS API. Used where outbound SMTP ports are blocked
 * (for example Railway's Hobby/Trial plans). Plain port 443, no extra package needed.
 */
class BrevoApiTransport extends AbstractTransport
{
    public function __construct(private string $apiKey)
    {
        parent::__construct();
    }

    protected function doSend(SentMessage $message): void
    {
        /** @var Email $email */
        $email = MessageConverter::toEmail($message->getOriginalMessage());
        $addr = fn (Address $a) => array_filter(['email' => $a->getAddress(), 'name' => $a->getName() ?: null]);

        $from = $email->getFrom()[0] ?? null;
        $payload = [
            'sender' => $addr($from),
            'to' => array_map($addr, $email->getTo()),
            'subject' => (string) $email->getSubject(),
        ];
        if ($email->getCc()) {
            $payload['cc'] = array_map($addr, $email->getCc());
        }
        if ($email->getReplyTo()) {
            $payload['replyTo'] = $addr($email->getReplyTo()[0]);
        }
        if ($email->getHtmlBody() !== null) {
            $payload['htmlContent'] = (string) $email->getHtmlBody();
        }
        if ($email->getTextBody() !== null) {
            $payload['textContent'] = (string) $email->getTextBody();
        }

        // Pass through the bulk-mail headers (List-Unsubscribe etc.).
        $headers = [];
        foreach (['List-Unsubscribe', 'List-Unsubscribe-Post', 'Precedence'] as $name) {
            if ($email->getHeaders()->has($name)) {
                $headers[$name] = $email->getHeaders()->get($name)->getBodyAsString();
            }
        }
        if ($headers) {
            $payload['headers'] = $headers;
        }

        $res = Http::withHeaders(['api-key' => $this->apiKey, 'accept' => 'application/json'])
            ->timeout(20)->post('https://api.brevo.com/v3/smtp/email', $payload);

        if (! $res->successful()) {
            throw new TransportException('Brevo API error '.$res->status().': '.substr($res->body(), 0, 300));
        }
    }

    public function __toString(): string
    {
        return 'brevo-api';
    }
}
