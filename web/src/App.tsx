import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import UserLayout from "./components/UserLayout";
import { RequireAuth } from "./components/RequireAuth";
import AdminAuth from "./pages/AdminAuth";
import UserAuth from "./pages/UserAuth";
import Profile from "./pages/Profile";
import Upload from "./pages/Upload";
import AdminStats from "./pages/admin/Stats";
import AdminModelConfig from "./pages/admin/ModelConfig";
import AdminUsers from "./pages/admin/Users";
import { useAuth } from "./lib/auth";

export default function App() {
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <Routes>
      {/* user portal */}
      <Route path="/login" element={<UserAuth mode="login" />} />
      <Route path="/register" element={<UserAuth mode="register" />} />

      {/* admin portal */}
      <Route path="/admin/login" element={<AdminAuth />} />

      {/* user app */}
      <Route
        element={
          <RequireAuth requires="user">
            <UserLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/profile" replace />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/upload" element={<Upload />} />
      </Route>

      {/* admin app */}
      <Route
        element={
          <RequireAuth requires="admin">
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route path="/admin" element={<Navigate to="/admin/stats" replace />} />
        <Route path="/admin/stats" element={<AdminStats />} />
        <Route path="/admin/models" element={<AdminModelConfig />} />
        <Route path="/admin/users" element={<AdminUsers />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
