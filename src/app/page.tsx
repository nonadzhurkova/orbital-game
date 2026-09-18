import GameCanvas from "@/render/GameCanvas";
import HUD from "@/components/HUD";

export default function Home() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#070b14]">
      <GameCanvas />
      <HUD />
    </main>
  );
}
