import { Component, input } from "@angular/core";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { FR } from "../core/fr";
import { installmentLabel } from "./money.pipe";
@Component({
  selector: "app-icon",
  standalone: true,
  template:
    '<span class="material-symbols-outlined" aria-hidden="true">{{name()}}</span>',
})
export class IconComponent {
  name = input.required<string>();
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
