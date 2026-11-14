// 곁에 — 목걸이 마이크로비트 (낙상 감지 → 무선으로 알림)
// makecode.microbit.org → 새 프로젝트 → 위쪽 "JavaScript" 탭 → 전부 지우고 붙여넣기 → 다운로드
//
// 낙상 판단 3단계 (앉기·걷기·흔들기를 낙상으로 잘못 잡지 않게):
//  1) 자유낙하: 가속도 크기가 평소(약 1000mg)보다 크게 줄어든다 (몸이 붕 뜸)
//  2) 충격: 0.8초 안에 2500mg 넘는 큰 충격 (바닥에 부딪힘)
//  3) 정지: 그 뒤 1.5초 동안 거의 안 움직인다 (쓰러져 있음)
// 셋 다 맞으면 낙상 → 받는 쪽 마이크로비트로 "FALL" 을 보낸다.

radio.setGroup(77)                 // 받는 쪽과 같은 번호여야 한다 (다른 팀과 겹치지 않게 바꿔도 된다)
radio.setTransmitPower(7)
input.setAccelerometerRange(AcceleratorRange.EightG)   // 기본 2g 로는 충격이 2048mg 에서 잘린다

const FREEFALL_MG = 500
const IMPACT_MG = 2500
const IMPACT_WINDOW_MS = 800
const STILL_MS = 1500
let freefallAt = -10000
let lastFallAt = -100000

basic.showIcon(IconNames.Heart)

function isStill(): boolean {
    // 1.5초 동안 50ms 마다 재서, 80% 이상이 "가만히 있는 값"(800~1250mg)이면 정지
    let still = 0
    const n = STILL_MS / 50
    for (let i = 0; i < n; i++) {
        const a = input.acceleration(Dimension.Strength)
        if (a > 800 && a < 1250) still++
        basic.pause(50)
    }
    return still >= n * 0.8
}

function reportFall() {
    lastFallAt = control.millis()
    radio.sendString("FALL")
    basic.showIcon(IconNames.Sad)
    music.playTone(880, music.beat(BeatFraction.Half))
    basic.pause(1500)
    basic.showIcon(IconNames.Heart)
}

basic.forever(function () {
    const a = input.acceleration(Dimension.Strength)
    const now = control.millis()
    if (a < FREEFALL_MG) freefallAt = now
    if (a > IMPACT_MG && now - freefallAt < IMPACT_WINDOW_MS && now - lastFallAt > 5000) {
        basic.showIcon(IconNames.Surprised)
        if (isStill()) reportFall()
        else basic.showIcon(IconNames.Heart)   // 충격 뒤 바로 움직이면 낙상 아님
    }
})

// 시험용: A 버튼 = 낙상 신호를 바로 보낸다 (배선·무선 확인할 때)
input.onButtonPressed(Button.A, function () {
    reportFall()
})
