import { Pipe, PipeTransform } from "@angular/core";
export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0).replace(/[\s\u00a0]/g, "\u202f")} FCFA`;
}
@Pipe({ name: "fcfa", standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return formatMoney(value);
  }
}
export function installmentLabel(
  status: string,
): "paid" | "partial" | "upcoming" | "overdue" {
  return status === "paid" || status === "partial" || status === "overdue"
    ? status
    : "upcoming";
}
