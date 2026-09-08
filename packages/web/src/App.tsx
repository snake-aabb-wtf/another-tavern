import Probe from "./Probe";

export default function App() {
  return (
    <main className="min-h-svh bg-neutral-950 text-neutral-50">
      <header className="border-b border-neutral-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Another Tavern</h1>
      </header>
      <Probe />
    </main>
  );
}
