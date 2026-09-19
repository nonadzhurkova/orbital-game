import GameCanvas from "@/render/GameCanvas";
import HUD from "@/components/HUD";
import ProfileHUD from "@/components/ProfileHUD";
import ProgressGate from "@/components/ProgressGate";

export default function Home() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#070b14]">
      <ProgressGate>
        <GameCanvas />
        <HUD />
      </ProgressGate>
      <ProfileHUD />
    </main>
  );
}
