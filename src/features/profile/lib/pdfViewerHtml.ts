/**
 * WHAT:  pdfViewerHtml — the page YourDataScreen loads into a WebView to show
 *        the data-export PDF: pdf.js draws each page to a canvas, and the
 *        PDF's links become tap targets that ask the app to open them.
 * WHY:   Android can't show a PDF in the in-app browser (a Custom Tab shows a
 *        blank page — owner, 2026-10-26), and the installed app has no module
 *        to hand a file to another app (no expo-sharing / intent launcher; a
 *        native build). react-native-webview IS installed (the ID check), and
 *        pdf.js in it opens the file on every phone with nothing else needed.
 *
 *        ⚠️ PINNED + INTEGRITY-CHECKED: pdf.js 3.11.174 (the last UMD build, so
 *        no module loader) from cdnjs with sha384 SRI — a changed file fails to
 *        load and the screen shows its error state rather than run it. The
 *        worker script is loaded on the page itself (globalThis.pdfjsWorker),
 *        so pdf.js runs it on the main thread and never builds a Worker from a
 *        cross-origin URL.
 *
 *        ⚠️ THE PAGE NAVIGATES NOWHERE. Links post {type:'open', url} and the
 *        screen opens https ones with Linking; the WebView refuses every
 *        navigation (YourDataScreen's onShouldStartLoadWithRequest).
 *
 *        Messages out: {type:'ready'} once pdf.js loaded (then the screen calls
 *        window.showPdf(base64)), {type:'rendered'}, {type:'error'},
 *        {type:'open', url}.
 * LINKS: ../screens/YourDataScreen.tsx;
 *        supabase/functions/_shared/pdfDocument.ts (what draws the file).
 */

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

/** What the viewer page posts back. */
export type PdfViewerMessage =
  { type: 'ready' } | { type: 'rendered' } | { type: 'error' } | { type: 'open'; url: string };

/** Parses a message from the page; anything else is null. */
export function parsePdfViewerMessage(data: string): PdfViewerMessage | null {
  try {
    const message = JSON.parse(data) as { type?: unknown; url?: unknown };
    if (message.type === 'ready' || message.type === 'rendered' || message.type === 'error') {
      return { type: message.type };
    }
    if (message.type === 'open' && typeof message.url === 'string') {
      return { type: 'open', url: message.url };
    }
  } catch {
    // Not ours.
  }
  return null;
}

/** The viewer page, on the screen's background colour. */
export function pdfViewerHtml(background: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<style>
  html, body { margin: 0; background: ${background}; }
  #pages { padding: 12px; }
  .page { position: relative; width: 100%; margin: 0 0 12px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.25); }
  .page canvas { display: block; width: 100%; height: auto; }
  .link { position: absolute; display: block; }
</style>
<script src="${PDFJS}/pdf.worker.min.js" integrity="sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2" crossorigin="anonymous"></script>
<script src="${PDFJS}/pdf.min.js" integrity="sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e" crossorigin="anonymous"></script>
</head>
<body>
<div id="pages"></div>
<script>
(function () {
  function post(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  if (!window.pdfjsLib || !window.pdfjsWorker) { post({ type: 'error' }); return; }

  async function render(doc) {
    var container = document.getElementById('pages');
    var width = container.clientWidth - 24;
    var ratio = window.devicePixelRatio || 1;
    for (var n = 1; n <= doc.numPages; n += 1) {
      var page = await doc.getPage(n);
      var viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
      // Pages are 100% wide and links placed in %, so a later resize (a
      // rotation) scales them rather than spilling off the side.
      var box = document.createElement('div');
      box.className = 'page';
      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      box.appendChild(canvas);
      container.appendChild(box);
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
      }).promise;
      var annotations = await page.getAnnotations();
      annotations.forEach(function (a) {
        if (a.subtype !== 'Link' || typeof a.url !== 'string') return;
        var r = viewport.convertToViewportRectangle(a.rect);
        var link = document.createElement('a');
        link.className = 'link';
        link.style.left = (Math.min(r[0], r[2]) / viewport.width) * 100 + '%';
        link.style.top = (Math.min(r[1], r[3]) / viewport.height) * 100 + '%';
        link.style.width = (Math.abs(r[2] - r[0]) / viewport.width) * 100 + '%';
        link.style.height = (Math.abs(r[3] - r[1]) / viewport.height) * 100 + '%';
        var url = a.url;
        link.addEventListener('click', function (event) {
          event.preventDefault();
          post({ type: 'open', url: url });
        });
        box.appendChild(link);
      });
    }
  }

  window.showPdf = function (base64) {
    var raw = atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise
      .then(render)
      .then(function () { post({ type: 'rendered' }); })
      .catch(function () { post({ type: 'error' }); });
  };
  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
