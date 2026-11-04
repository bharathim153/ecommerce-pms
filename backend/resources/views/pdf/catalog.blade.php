<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page {
    size: A4;
    margin: 24mm 16mm 20mm 16mm;
    @top-left   { content: "{{ addslashes($brand) }} — Product Catalog"; font: 8.5pt Helvetica, Arial, sans-serif; color: #64748b; border-bottom: .4pt solid #cbd5e1; padding-bottom: 2mm; vertical-align: bottom; }
    @top-right  { content: "{{ $generatedAt }}"; font: 8.5pt Helvetica, Arial, sans-serif; color: #64748b; border-bottom: .4pt solid #cbd5e1; padding-bottom: 2mm; vertical-align: bottom; }
    @bottom-center { content: "Page " counter(page); font: 8.5pt Helvetica, Arial, sans-serif; color: #64748b; }
  }
  html { counter-reset: page {{ $offset }}; }
  * { box-sizing: border-box; }
  body { font: 10pt/1.55 Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; }
  .cover { height: 230mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; break-after: page; }
  .cover h1 { font-size: 30pt; margin: 0 0 6mm; }
  .cover p { color: #475569; margin: 1mm 0; font-size: 12pt; }
  .product { break-before: page; }
  .product:first-of-type { break-before: auto; }
  .product h2.title { font-size: 18pt; margin: 0 0 2mm; }
  .meta { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 9pt; }
  .meta td { border: .4pt solid #cbd5e1; padding: 1.2mm 2.5mm; }
  .meta td.k { background: #f1f5f9; color: #475569; width: 18%; font-weight: bold; }
  .hero { display: block; max-width: 100%; max-height: 95mm; margin: 0 auto 3mm; object-fit: contain; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 2mm; margin-bottom: 3mm; }
  .thumbs img { height: 24mm; width: auto; border: .4pt solid #cbd5e1; }
  .short { font-style: italic; color: #334155; margin: 2mm 0 3mm; }
  .rich h1 { font-size: 15pt; margin: 5mm 0 2mm; }
  .rich h2 { font-size: 13pt; margin: 4.5mm 0 2mm; }
  .rich h3, .rich h4 { font-size: 11pt; margin: 4mm 0 1.5mm; }
  .rich h1, .rich h2, .rich h3, .rich h4 { break-after: avoid; }
  .rich p { margin: 1.8mm 0; }
  .rich ul, .rich ol { margin: 1.8mm 0; padding-left: 6mm; }
  .rich li { margin: .6mm 0; }
  .rich a { color: #4338ca; text-decoration: underline; }
  .rich img { max-width: 100%; height: auto; }
  .rich blockquote { border-left: 1mm solid #cbd5e1; margin: 2mm 0; padding-left: 4mm; color: #475569; }
  .rich table { width: 100%; border-collapse: collapse; margin: 3mm 0; table-layout: fixed; font-size: 9pt; }
  .rich thead { display: table-header-group; }
  .rich tr { break-inside: avoid; }
  .rich tr:first-child { break-after: avoid; }
  .rich h1 + table, .rich h2 + table, .rich h3 + table { break-before: avoid; }
  .rich th, .rich td { border: .4pt solid #94a3b8; padding: 1.2mm 2mm; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
  .rich th { background: #e2e8f0; font-weight: bold; }
  .rich td > p, .rich th > p { margin: 0; }
</style>
</head>
<body>
@if($cover)
  <section class="cover">
    <h1>{{ $brand }}</h1>
    <p style="font-size:16pt;color:#0f172a">Product Catalog</p>
    <p>{{ $cover['count'] }} {{ \Illuminate\Support\Str::plural('product', $cover['count']) }}</p>
    <p>Generated {{ $generatedAt }}</p>
  </section>
@endif
@foreach($items as $it)
  @php($p = $it['product'])
  <article class="product">
    <h2 class="title">{{ $p->name }}</h2>
    <table class="meta">
      <tr><td class="k">SKU</td><td>{{ $p->sku }}</td><td class="k">Price</td><td>${{ number_format((float) $p->price, 2) }}</td></tr>
      <tr><td class="k">Category</td><td>{{ $p->category?->name ?? '—' }}</td><td class="k">Status</td><td>{{ ucfirst($p->status) }} · Stock {{ $p->stock }}</td></tr>
    </table>
    @if($it['hero'])<img class="hero" src="{{ $it['hero']['src'] }}" alt="">@endif
    @if($it['extra']->isNotEmpty())
      <div class="thumbs">@foreach($it['extra'] as $img)<img src="{{ $img['src'] }}" alt="">@endforeach</div>
    @endif
    @if($p->short_description)<p class="short">{{ $p->short_description }}</p>@endif
    <div class="rich">{!! $it['description'] !!}</div>
  </article>
@endforeach
</body>
</html>
