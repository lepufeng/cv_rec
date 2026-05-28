import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/profile", label: "我的简历" },
  { to: "/upload", label: "上传简历" },
];

export default function UserLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const handleLogout = () => {
    logout("user");
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-ink-200">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/profile" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-accent text-white text-sm flex items-center justify-center font-semibold">
                C
              </div>
              <span className="font-semibold tracking-tight">CV Rec</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md transition-colors ${
                      isActive
                        ? "bg-accent-light text-accent"
                        : "text-ink-700 hover:bg-ink-100"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-ink-700">{user.username}</span>
            <button onClick={handleLogout} className="btn-secondary !py-1.5 !px-3">
              退出
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
