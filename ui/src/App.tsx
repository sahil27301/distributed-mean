import { NavLink, Route, Routes } from "react-router-dom";
import { JobPage } from "./pages/JobPage";
import { JobsPage } from "./pages/JobsPage";
import { WorkersPage } from "./pages/WorkersPage";

export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="wordmark">
          Distributed Mean
        </NavLink>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/" end className="topnav__link">
            Jobs
          </NavLink>
          <NavLink to="/workers" className="topnav__link">
            Workers
          </NavLink>
        </nav>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="*" element={<p className="muted">Nothing here. Go back to the job list.</p>} />
        </Routes>
      </main>
    </div>
  );
}
