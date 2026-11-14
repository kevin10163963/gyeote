// 곁에 — 받는 쪽 마이크로비트 (ESP32 옆에 둔다)
// 목걸이가 보낸 "FALL" 을 받으면 P0 를 1초 동안 HIGH → ESP32 IO4 가 낙상 카운트다운을 시작한다.
// 배선: 마이크로비트 P0 → ESP32 IO4, 마이크로비트 GND → ESP32 GND (GND 를 꼭 같이 연결)

radio.setGroup(77)                 // 목걸이와 같은 번호
pins.digitalWritePin(DigitalPin.P0, 0)
basic.showIcon(IconNames.Yes)

function pulse() {
    basic.showIcon(IconNames.No)
    pins.digitalWritePin(DigitalPin.P0, 1)
    basic.pause(1000)
    pins.digitalWritePin(DigitalPin.P0, 0)
    basic.showIcon(IconNames.Yes)
}

radio.onReceivedString(function (s) {
    if (s == "FALL") pulse()
})

// 시험용: A 버튼 = 무선 없이 바로 ESP32 에 낙상 신호 (배선 확인)
input.onButtonPressed(Button.A, function () {
    pulse()
})
