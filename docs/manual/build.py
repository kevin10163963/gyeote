# 설명서 만들기: template.html 의 {{...}} 자리에 실제 코드 파일을 넣어 설명서.html 을 만든다
import html, pathlib, sys
root = pathlib.Path(__file__).resolve().parents[2]
t = (root / 'docs/manual/template.html').read_text()
for key, path in {'PENDANT': 'firmware/microbit/pendant.ts', 'RECEIVER': 'firmware/microbit/receiver.ts', 'ESP32': 'firmware/esp32/esp32.ino'}.items():
    t = t.replace('{{%s}}' % key, html.escape((root / path).read_text().rstrip()))
t = t.replace('{{COMPILE_NOTE}}', sys.argv[1] if len(sys.argv) > 1 else '')
(root / 'docs/manual/설명서.html').write_text(t)
print('ok', len(t))
