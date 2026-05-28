import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

const NAV = [
  { to: "/admin/stats", label: "总览" },
  { to: "/admin/models", label: "模型配置" },
  { to: "/admin/users", label: "用户管理" },
];

export default function AdminLayout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  if (!admin) return null;

  const handleLogout = () => {
    logout("admin");
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-ink-900 text-white">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/admin/stats" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-white text-ink-900 text-sm flex items-center justify-center font-semibold">
                A
              </div>
              <span className="font-semibold tracking-tight">CV Rec · Admin</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md transition-colors ${
                      isActive
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/5 hover:text-white"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-white/80">
              {admin.username}
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/30">
                admin
              </span>
            </span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-md text-sm border border-white/20 hover:bg-white/10 transition-colors"
            >
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
