import { useState } from "react";
import { BackgroundPaths } from "@/components/ui/background-paths";
import { AgentsPage } from "@/pages/AgentsPage";
import { DashboardPage } from "@/pages/DashboardPage";

type Screen = "landing" | "agents" | "dashboard";

export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");

  if (screen === "landing") {
    return (
      <BackgroundPaths
        title="FLOAT"
        ctaLabel="Meet the agents"
        onCta={() => setScreen("agents")}
      />
    );
  }

  if (screen === "agents") {
    return (
      <AgentsPage
        onBack={() => setScreen("landing")}
        onContinue={() => setScreen("dashboard")}
      />
    );
  }

  return <DashboardPage onBack={() => setScreen("agents")} />;
}
