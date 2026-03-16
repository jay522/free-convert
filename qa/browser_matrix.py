import base64
import http.server
import os
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XhZ0AAAAASUVORK5CYII="
)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        return


def build_pdf_arrays(page):
    return page.evaluate(
        """async () => {
            const makePdf = async (label) => {
              const pdf = await window.PDFLib.PDFDocument.create();
              const page = pdf.addPage([200, 200]);
              page.drawText(label, { x: 40, y: 100, size: 24 });
              return Array.from(await pdf.save());
            };
            return [await makePdf('One'), await makePdf('Two')];
        }"""
    )


def build_webm_bytes(page):
    return page.evaluate(
        """async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 96;
            canvas.height = 96;
            const context = canvas.getContext('2d');
            const stream = canvas.captureStream(12);
            const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp8')
              ? 'video/webm; codecs=vp8'
              : 'video/webm';
            const recorder = new MediaRecorder(stream, { mimeType });
            const chunks = [];
            recorder.ondataavailable = (event) => {
              if (event.data.size > 0) chunks.push(event.data);
            };
            const stopped = new Promise((resolve) => {
              recorder.onstop = resolve;
            });
            recorder.start();
            for (let frame = 0; frame < 18; frame += 1) {
              context.fillStyle = frame % 2 === 0 ? '#ef6c42' : '#146c63';
              context.fillRect(0, 0, 96, 96);
              context.fillStyle = '#ffffff';
              context.font = '20px sans-serif';
              context.fillText(String(frame), 34, 56);
              await new Promise((resolve) => requestAnimationFrame(resolve));
            }
            recorder.stop();
            await stopped;
            const blob = new Blob(chunks, { type: 'video/webm' });
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }"""
    )


def install_mock_display_capture(page):
    page.evaluate(
        """() => {
            if (!navigator.mediaDevices) {
              Object.defineProperty(navigator, 'mediaDevices', {
                value: {},
                configurable: true,
              });
            }

            navigator.mediaDevices.getDisplayMedia = async () => {
              const canvas = document.createElement('canvas');
              canvas.width = 640;
              canvas.height = 360;
              const context = canvas.getContext('2d');
              let frame = 0;

              const draw = () => {
                frame += 1;
                context.fillStyle = frame % 2 === 0 ? '#ef6c42' : '#146c63';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.fillStyle = '#ffffff';
                context.font = 'bold 36px sans-serif';
                context.fillText('free-converter', 34, 160);
                context.fillText(`Frame ${frame}`, 34, 214);
                requestAnimationFrame(draw);
              };

              draw();
              return canvas.captureStream(24);
            };
        }"""
    )


def run_recorder_checks(page):
    capabilities = page.evaluate(
        """() => ({
            hasMediaRecorder: typeof MediaRecorder !== 'undefined',
            hasCaptureStream: !!HTMLCanvasElement.prototype.captureStream,
            hasDisplayMedia: !!navigator.mediaDevices?.getDisplayMedia,
        })"""
    )

    if (
        not capabilities["hasMediaRecorder"]
        or not capabilities["hasCaptureStream"]
        or not capabilities["hasDisplayMedia"]
    ):
        assert page.locator("#startRecordingButton").is_disabled()
        return {
            "supported": False,
            "title": "unsupported",
        }

    install_mock_display_capture(page)
    format_values = page.locator("#recordFormatSelect option").evaluate_all(
        "(nodes) => nodes.map((node) => node.value)"
    )
    recorder_format = "mp4" if "mp4" in format_values else format_values[0]

    page.locator("#recordFormatSelect").select_option(recorder_format)
    page.locator("#recordQualitySelect").select_option("balanced")
    page.locator("#recordWidthSelect").select_option("1280")
    page.locator("#recordFpsSelect").select_option("24")
    if page.locator("#recordAudioCheckbox").is_checked():
        page.locator("#recordAudioCheckbox").uncheck()

    page.locator("#startRecordingButton").click()
    page.wait_for_function(
        """() => {
            const text = document.querySelector('#recorderStatusText')?.textContent || '';
            return text.includes('Recording');
        }""",
        timeout=15000,
    )
    page.wait_for_timeout(1800)
    page.locator("#stopRecordingButton").click()
    page.wait_for_function(
        """() => {
            const status = document.querySelector('#recorderStatusText')?.textContent || '';
            const count = document.querySelectorAll('.download-title').length;
            return count > 0 && status.includes('Recording ready to download');
        }""",
        timeout=180000,
    )

    title = page.locator(".download-title").first.text_content()
    assert title.endswith(f".{recorder_format}")
    assert page.locator("#recorderStatusText").text_content() == "Recording ready to download"
    return {
        "supported": True,
        "title": title,
    }


def run_browser_checks(playwright, browser_name, webm_bytes):
    browser_type = getattr(playwright, browser_name)
    browser = browser_type.launch()
    page = browser.new_page()
    page.goto("http://127.0.0.1:8090", wait_until="domcontentloaded", timeout=30000)

    page.locator("#presetSelect").select_option("imagesToPdf")
    page.locator("#fileInput").set_input_files(
        [
            {
                "name": "sample.png",
                "mimeType": "image/png",
                "buffer": PNG_BYTES,
            }
        ]
    )
    page.locator("#convertButton").click()
    page.wait_for_function(
        "() => document.querySelector('#statusText')?.textContent.includes('PDF conversion finished.')",
        timeout=30000,
    )
    assert page.locator(".download-title").first.text_content() == "converted-images.pdf"

    pdf_arrays = build_pdf_arrays(page)
    page.locator("#presetSelect").select_option("mergePdf")
    page.locator("#fileInput").set_input_files(
        [
            {
                "name": "one.pdf",
                "mimeType": "application/pdf",
                "buffer": bytes(pdf_arrays[0]),
            },
            {
                "name": "two.pdf",
                "mimeType": "application/pdf",
                "buffer": bytes(pdf_arrays[1]),
            },
        ]
    )
    page.locator("#convertButton").click()
    page.wait_for_function(
        "() => document.querySelector('#statusText')?.textContent.includes('PDF merge finished.')",
        timeout=30000,
    )
    assert page.locator(".download-title").first.text_content() == "merged-documents.pdf"

    page.locator("#presetSelect").select_option("imageToWebp")
    page.locator("#fileInput").set_input_files(
        [
            {
                "name": "sample.png",
                "mimeType": "image/png",
                "buffer": PNG_BYTES,
            }
        ]
    )
    page.locator("#convertButton").click()
    page.wait_for_function(
        "() => document.querySelector('#statusText')?.textContent.includes('Image conversion finished.')",
        timeout=30000,
    )
    assert page.locator(".download-title").first.text_content() == "sample.webp"

    page.locator("#presetSelect").select_option("webmToMp4")
    page.locator("#fileInput").set_input_files(
        [
            {
                "name": "sample.webm",
                "mimeType": "video/webm",
                "buffer": bytes(webm_bytes),
            }
        ]
    )
    page.locator("#convertButton").click()
    page.wait_for_function(
        """() => {
            const text = document.querySelector('#statusText')?.textContent || '';
            return text.includes('Video conversion finished.') || text.includes('Conversion failed');
        }""",
        timeout=180000,
    )
    assert page.locator("#statusText").text_content() == "Video conversion finished."
    assert page.locator(".download-title").first.text_content() == "sample.mp4"

    recorder_summary = run_recorder_checks(page)

    page.locator("#profileNameInput").fill("QA")
    page.locator("#saveProfileButton").click()
    page.locator("#pinInput").fill("1234")
    page.locator("#setPinButton").click()
    page.wait_for_timeout(300)
    page.locator("#lockButton").click()
    page.wait_for_timeout(300)
    assert page.locator("#convertButton").is_disabled()
    page.locator("#unlockPinInput").fill("1234")
    page.locator("#unlockButton").click()
    page.wait_for_timeout(300)
    minimum_history = 5 if recorder_summary["supported"] else 4
    assert page.locator(".history-item").count() >= minimum_history

    summary = {
        "history_count": page.locator(".history-item").count(),
        "success_count": page.locator("#statSuccess").text_content(),
        "recorder_title": recorder_summary["title"],
    }
    browser.close()
    return summary


def main():
    os.chdir(ROOT)
    server = socketserver.TCPServer(("127.0.0.1", 8090), QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    failures = []

    try:
        with sync_playwright() as playwright:
            seed_browser = playwright.chromium.launch()
            seed_page = seed_browser.new_page()
            seed_page.goto("http://127.0.0.1:8090", wait_until="domcontentloaded", timeout=30000)
            webm_bytes = build_webm_bytes(seed_page)
            seed_browser.close()

            for browser_name in ("chromium", "firefox", "webkit"):
                try:
                    summary = run_browser_checks(playwright, browser_name, webm_bytes)
                    print(
                        f"{browser_name}: ok "
                        f"(history={summary['history_count']}, success={summary['success_count']}, "
                        f"recorder={summary['recorder_title']})"
                    )
                except Exception as exc:  # noqa: BLE001
                    failures.append((browser_name, str(exc)))
                    print(f"{browser_name}: failed -> {exc}")
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        for browser_name, message in failures:
            print(f"{browser_name}: {message}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
