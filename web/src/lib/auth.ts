import { create } from "zustand";
import {
  endpoints,
  getToken,
  setToken,
  type AuthRole,
  type AuthResponse,
  type CurrentUser,
} from "./api";

type AuthState = {
  user: CurrentUser | null;
  admin: CurrentUser | null;
  loadingUser: boolean;
  loadingAdmin: boolean;
  bootstrap: () => Promise<void>;
  bootstrapRole: (role: AuthRole) => Promise<void>;
  applyAuth: (resp: AuthResponse) => CurrentUser;
  logout: (role?: AuthRole) => void;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  admin: null,
  loadingUser: true,
  loadingAdmin: true,
  bootstrapRole: async (role) => {
    const loadingKey = role === "admin" ? "loadingAdmin" : "loadingUser";
    const userKey = role === "admin" ? "admin" : "user";
    if (!getToken(role)) {
      set({ [loadingKey]: false, [userKey]: null });
      return;
    }
    try {
      const account = await endpoints.me(role);
      if ((role === "admin") !== account.is_admin) {
        setToken(null, role);
        set({ [userKey]: null, [loadingKey]: false });
        return;
      }
      const token = getToken(role);
      if (token) setToken(token, role);
      set({ [userKey]: account, [loadingKey]: false });
    } catch {
      setToken(null, role);
      set({ [userKey]: null, [loadingKey]: false });
    }
  },
  bootstrap: async () => {
    const state = useAuth.getState();
    await Promise.all([state.bootstrapRole("user"), state.bootstrapRole("admin")]);
  },
  applyAuth: (resp) => {
    const role: AuthRole = resp.is_admin ? "admin" : "user";
    setToken(resp.token, role);
    const user: CurrentUser = {
      user_id: resp.user_id,
      username: resp.username,
      is_admin: resp.is_admin,
      plan_tier: resp.plan_tier,
    };
    if (role === "admin") set({ admin: user, loadingAdmin: false });
    else set({ user, loadingUser: false });
    return user;
  },
  logout: (role = "user") => {
    setToken(null, role);
    if (role === "admin") set({ admin: null });
    else set({ user: null });
  },
}));
