import { type Routes } from "@angular/router";
import { schoolGuard, authGuard, roleGuard, guestGuard } from "./core/guards";
export const routes: Routes = [
  {
    path: "",
    loadComponent: () =>
      import("./pages/landing").then((m) => m.LandingComponent),
  },
  {
    path: "s/:school",
    canActivate: [schoolGuard],
    loadComponent: () => import("./pages/shell").then((m) => m.ShellComponent),
    children: [
      {
        path: "reinitialiser",
        loadComponent: () =>
          import("./pages/recovery").then((m) => m.RecoveryComponent),
      },
      { path: "", pathMatch: "full", redirectTo: "connexion" },
      {
        path: "connexion",
        canActivate: [guestGuard],
        loadComponent: () =>
          import("./pages/auth").then((m) => m.AuthPageComponent),
      },
      {
        path: "inscription",
        canActivate: [guestGuard],
        loadComponent: () =>
          import("./pages/auth").then((m) => m.AuthPageComponent),
      },
      ...["accueil", "paiements", "acces-expire"].map((path, index) => ({
        path,
        canActivate: [authGuard, roleGuard],
        data: { role: "student", view: ["home", "payments", "expired"][index] },
        loadComponent: () =>
          import("./pages/student").then((m) => m.StudentPageComponent),
      })),
      {
        path: "cours",
        canActivate: [authGuard, roleGuard],
        data: { role: "student" },
        loadComponent: () =>
          import("./pages/courses").then((m) => m.CoursesComponent),
      },
      {
        path: "quiz",
        canActivate: [authGuard, roleGuard],
        data: { role: "student" },
        loadComponent: () =>
          import("./pages/quiz").then((m) => m.QuizComponent),
      },
      {
        path: "admin",
        canActivate: [authGuard, roleGuard],
        data: { role: "admin" },
        children: [
          {
            path: "",
            loadComponent: () =>
              import("./pages/admin").then((m) => m.AdminDashboardComponent),
          },
          {
            path: "eleves",
            loadComponent: () =>
              import("./pages/students").then((m) => m.StudentListComponent),
          },
          {
            path: "eleves/nouveau",
            loadComponent: () =>
              import("./pages/students").then((m) => m.NewStudentComponent),
          },
          {
            path: "eleves/:id",
            loadComponent: () =>
              import("./pages/students").then((m) => m.DossierComponent),
          },
          {
            path: "paiement/:id",
            loadComponent: () =>
              import("./pages/payment").then((m) => m.PaymentComponent),
          },
          {
            path: "groupes",
            loadComponent: () =>
              import("./pages/groups").then((m) => m.GroupsComponent),
          },
          {
            path: "journal",
            loadComponent: () =>
              import("./pages/reports").then((m) => m.ReportsComponent),
          },
          {
            path: "rapport",
            loadComponent: () =>
              import("./pages/reports").then((m) => m.ReportsComponent),
          },
          {
            path: "parametres",
            loadComponent: () =>
              import("./pages/settings").then((m) => m.SettingsComponent),
          },
        ],
      },
    ],
  },
  { path: "**", redirectTo: "" },
];
