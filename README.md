# 곁에 — 가족 화면

혼자 사는 어르신 집의 센서(PIR·SOS 버튼·약통·낙상)를 ESP32가 판단해 Firebase에 올리면,
멀리 사는 가족이 이 화면에서 실시간으로 본다. 경보가 오면 [확인했어요]로 집 안 부저를 끈다.

- 2026 KIS HCMC SW융합 해커톤 (주제: 디지털 기술로 만드는 건강한 일상)
- 데이터 약속: [docs/firebase-약속.md](docs/firebase-약속.md)
- 주소 끝에 `?demo` 를 붙이면 하드웨어 없이 가짜 집으로 시연한다.

```bash
npm install
echo "VITE_FIREBASE_DB_URL=https://<프로젝트>.firebasedatabase.app" > .env.local
npm run dev
```
