import { Component, computed, input } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { FR } from "../core/fr";
import { installmentLabel } from "./money.pipe";
@Component({
  selector: "app-icon",
  standalone: true,
  template:
    '<span class="material-symbols-outlined" aria-hidden="true" [style.font-size.px]="size()">{{name()}}</span>',
})
export class IconComponent {
  name = input.required<string>();
  /** Optional pixel size; inherits the CSS size when omitted. */
  size = input<number | null>(null);
}
/** Shimmer placeholder shown while page data loads (no raw text, no icons). */
@Component({
  selector: "app-skeleton",
  standalone: true,
  template: `<div
    class="skeleton"
    [class]="'skeleton skeleton-' + variant()"
    role="status"
    aria-busy="true"
    [attr.aria-label]="t.loading"
  >
    @switch (variant()) {
      @case ("list") {
        <div class="card skeleton-card">
          @for (i of items(); track i) {
            <div class="skeleton-row">
              <span class="sk sk-avatar"></span>
              <span class="skeleton-lines">
                <span class="sk sk-line w-60"></span>
                <span class="sk sk-line w-40"></span>
              </span>
            </div>
          }
        </div>
      }
      @case ("dashboard") {
        <div class="skeleton-stats">
          @for (i of [0, 1, 2, 3]; track i) {
            <div class="card skeleton-card">
              <span class="sk sk-line w-40"></span>
              <span class="sk sk-title w-60"></span>
            </div>
          }
        </div>
        <div class="grid-two">
          @for (i of items(); track i) {
            <div class="card skeleton-card">
              <span class="sk sk-title w-60"></span>
              <span class="sk sk-line"></span>
              <span class="sk sk-line w-80"></span>
            </div>
          }
        </div>
      }
      @case ("detail") {
        <div class="card skeleton-card">
          <span class="sk sk-title w-60"></span>
          <span class="sk sk-line"></span>
          <span class="sk sk-line w-80"></span>
          <span class="sk sk-block"></span>
          @for (i of items(); track i) {
            <span class="sk sk-line w-80"></span>
          }
        </div>
      }
      @default {
        <div class="grid-two">
          @for (i of items(); track i) {
            <div class="card skeleton-card">
              <span class="sk sk-icon"></span>
              <span class="sk sk-title w-60"></span>
              <span class="sk sk-line"></span>
              <span class="sk sk-line w-80"></span>
              <span class="sk sk-btn"></span>
            </div>
          }
        </div>
      }
    }
  </div>`,
})
export class SkeletonComponent {
  t = FR;
  variant = input<"cards" | "list" | "dashboard" | "detail">("cards");
  count = input<number>(3);
  items = computed(() =>
    Array.from({ length: Math.max(1, Math.min(12, this.count())) }, (_, i) => i),
  );
}
@Component({
  selector: "app-badge",
  standalone: true,
  template: '<span class="badge" [class]="kind()">{{label()}}</span>',
})
export class BadgeComponent {
  kind = input("upcoming");
  label = input("");
}
@Component({
  selector: "app-empty",
  standalone: true,
  imports: [IconComponent],
  template:
    '<div class="empty"><app-icon name="inbox"/><p>{{text()}}</p></div>',
})
export class EmptyComponent {
  text = input(FR.empty as string);
}
@Component({
  selector: "app-bottom-nav",
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  template: `<nav class="bottom-nav" [attr.aria-label]="t.actions">
    @for (tab of tabs(); track tab.path) {
      <a
        [routerLink]="tab.path"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: true }"
        ><app-icon [name]="tab.icon" /><span>{{ tab.label }}</span></a
      >
    }
  </nav>`,
})
export class BottomNavComponent {
  t = FR;
  tabs = input.required<Array<{ path: string; label: string; icon: string }>>();
}
export { installmentLabel };
