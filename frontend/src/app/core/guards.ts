import { inject } from "@angular/core";
import { Router, type CanActivateFn } from "@angular/router";
import { AuthService } from "./auth.service";
export const schoolGuard: CanActivateFn = async (route) => {
  const a = inject(AuthService);
  await a.openSchool(route.paramMap.get("school") || "");
  return true;
};
export const authGuard: CanActivateFn = () => {
  const a = inject(AuthService);
  return (
    !!a.user() || inject(Router).createUrlTree(["/s", a.api.slug, "connexion"])
  );
};
export const roleGuard: CanActivateFn = (route) => {
  const a = inject(AuthService);
  return (
    a.role() === route.data["role"] ||
    inject(Router).createUrlTree([
      "/s",
      a.api.slug,
      a.role() === "admin"
        ? "admin"
        : a.role() === "student"
          ? "accueil"
          : "inscription",
    ])
  );
};

export const guestGuard: CanActivateFn = () => {
  const a = inject(AuthService);
  return (
    !a.role() ||
    inject(Router).createUrlTree([
      "/s",
      a.api.slug,
      a.role() === "admin" ? "admin" : "accueil",
    ])
  );
};
