// 대회 때 Claude가 이 화면부터 갈아엎는다. 지금은 시작 화면이 뜨는지만 본다.
export default function App() {
  return (
    <main className="min-h-dvh grid place-items-center bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="text-center px-6">
        <h1 className="text-3xl font-bold">준비 완료</h1>
        <p className="mt-3 text-neutral-500">React + TypeScript + Tailwind</p>
      </div>
    </main>
  )
}
