import { Navigate, useLocation } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

type Props = {
  children: ReactNode;
  requires: "user" | "admin";
};

export function RequireAuth({ children, requires }: Props) {
  const { user, admin, loadingUser, loadingAdmin } = useAuth();
  const location = useLocation();
  const account = requires === "admin" ? admin : user;
  const loading = requires === "admin" ? loadingAdmin : loadingUser;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-ink-500 text-sm">
        加载中…
      </div>
    );
  }

  if (!account) {
    const redirect = requires === "admin" ? "/admin/login" : "/login";
    return <Navigate to={redirect} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
