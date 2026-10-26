import HeroSection from "./HeroSection";
import PathwaysSection from "./PathwaysSection";
import ValuesSection from "./ValuesSection";
// oxlint-disable-next-line import/no-unassigned-import -- Static homepage presentation and progressive motion.
import "./homepage.css";

/** Rendered on the server: navigation and content never depend on hydration. */
export default function HomeIntroduction({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return <div className="home-introduction"><HeroSection isAuthenticated={isAuthenticated} /><PathwaysSection /><ValuesSection /></div>;
}
