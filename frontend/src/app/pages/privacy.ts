import { Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { AuthService } from "../core/auth.service";
import { ApiService } from "../core/api.service";

/**
 * Politique de confidentialité, in plain French. Shown at /confidentialite and
 * /s/<école>/confidentialite (then with the school's own name and contact).
 */
@Component({
  standalone: true,
  imports: [RouterLink],
  template: `<article class="card privacy">
    <a class="text-link back-link" [routerLink]="back()">← Retour</a>
    <span class="eyebrow">Vos données</span>
    <h1>Politique de confidentialité</h1>
    <p class="muted">Dernière mise à jour : 26 novembre 2026</p>

    <h2>Qui est responsable de vos données ?</h2>
    <p>
      <strong>{{ schoolName() }}</strong> est responsable des données de ses élèves. L’application
      « Espace auto-école » est l’outil qu’elle utilise pour les gérer ; elle ne vend ni ne partage
      vos données avec d’autres écoles ou des annonceurs.
    </p>

    <h2>Quelles données sont enregistrées ?</h2>
    <ul>
      <li>Votre nom, votre numéro de téléphone et, si vous en donnez un, votre adresse e-mail.</li>
      <li>Votre formation : permis, groupe, dates et échéances.</li>
      <li>Vos paiements et reçus (montant, date, mode de paiement).</li>
      <li>Vos résultats aux quiz et épreuves d’examen.</li>
      <li>Les informations techniques nécessaires à la sécurité de votre compte (connexion, appareil).</li>
    </ul>
    <p>Votre mot de passe est chiffré : personne, pas même l’école, ne peut le lire.</p>

    <h2>Pourquoi ?</h2>
    <ul>
      <li>Gérer votre inscription, vos cours et votre accès à l’application.</li>
      <li>Enregistrer vos paiements et vous remettre des reçus.</li>
      <li>Vous envoyer des rappels d’échéance et des annonces de votre groupe (si vous les activez).</li>
      <li>Suivre votre progression pour vous préparer à l’examen.</li>
    </ul>

    <h2>Qui peut les voir ?</h2>
    <p>
      Seule l’équipe de votre auto-école. Chaque école ne voit que ses propres élèves : les données
      sont séparées dans la base elle-même. Les paiements ne peuvent pas être effacés, seulement
      annulés avec un motif, et chaque action est enregistrée.
    </p>

    <h2>Où sont-elles stockées et combien de temps ?</h2>
    <p>
      Sur des serveurs sécurisés (chiffrement des échanges, sauvegarde quotidienne), situés dans
      l’Union européenne. Les données de formation sont conservées le temps de votre formation ;
      les paiements et reçus le temps exigé par les règles comptables.
    </p>

    <h2>Vos droits</h2>
    <p>
      Conformément à la réglementation camerounaise sur la protection des données personnelles, vous
      pouvez demander à consulter, corriger ou supprimer vos données (sauf celles que la loi oblige à
      conserver, comme les reçus), et retirer votre accord pour les rappels.
    </p>
    <p>
      Pour cela, contactez {{ schoolName() }}
      @if (phone()) {
        au <a [href]="'tel:' + phone()">{{ phone() }}</a>
      }
      ou passez à l’accueil.
    </p>
  </article>`,
})
export class PrivacyComponent {
  auth = inject(AuthService);
  api = inject(ApiService);
  schoolName = computed(() => this.auth.school()?.name || "votre auto-école");
  phone = computed(() => this.auth.school()?.phone || "");
  back = computed(() => (this.auth.school() ? "/s/" + this.api.slug : "/"));
}
