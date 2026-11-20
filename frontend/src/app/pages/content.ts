import { Component, inject, signal, OnInit, OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ApiService, RequestError } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import type { Category } from "../core/models";
import {
  type AdminResource,
  type AdminQuiz,
  type MaterialKind,
  type AuthorQuestion,
  validateMaterial,
  questionValid,
} from "../core/content";

@Component({
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./content.html",
  styles: [
    `
      .content-tools {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        align-items: end;
        margin-bottom: 20px;
      }
      .content-tools label,
      .content-tools > button:last-child {
        grid-column: 1/-1;
      }
      @media (min-width: 760px) {
        .content-tools {
          display: flex;
          flex-wrap: wrap;
        }
        .content-tools label {
          max-width: 320px;
        }
      }
      .content-tools label {
        flex: 1;
        min-width: 160px;
      }
      .content-list {
        display: grid;
        gap: 12px;
        margin-bottom: 24px;
      }
      .content-item {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
      }
      fieldset {
        min-width: 0;
        border: 1px solid #d5dce5;
        border-radius: 12px;
        padding: 16px;
        margin: 20px 0;
      }
      .option-row {
        display: flex;
        gap: 10px;
        align-items: center;
        margin: 8px 0;
      }
      .option-row input[type="radio"] {
        width: 20px;
        min-width: 20px;
        min-height: 20px;
      }
      .option-row input[type="text"] {
        flex: 1;
        min-width: 0;
      }
      .preview {
        border: 2px solid var(--primary, #3d8bcd);
        margin-top: 20px;
      }
      .success {
        padding: 12px;
        border-radius: 12px;
        background: #e7f4eb;
        color: #185d30;
      }
      .badge {
        padding: 4px 10px;
        border-radius: 12px;
        background: #eef2f7;
        font-size: 13px;
      }
      .question-image {
        max-width: 100%;
        max-height: 240px;
      }
    `,
  ],
})
export class ContentComponent implements OnInit, OnDestroy {
  api = inject(ApiService);
  auth = inject(AuthService);
  tab: "courses" | "quizzes" = "courses";
  resources = signal<AdminResource[]>([]);
  quizzes = signal<AdminQuiz[]>([]);
  categories = signal<Category[]>([]);
  loading = signal(false);
  busy = signal(false);
  error = signal("");
  success = signal("");
  filter = "";
  editing = false;
  preview = false;
  id = "";
  title = "";
  category = "";
  description = "";
  kind: MaterialKind = "pdf";
  externalUrl = "";
  storagePath: string | null = null;
  file: File | null = null;
  fileName = "";
  duration = 20;
  questions: AuthorQuestion[] = [];
  categoryEditor = false;
  newCategoryCode = "";
  newCategoryName = "";
  async addCategory() {
    if (this.busy() || !this.current()) return;
    this.busy.set(true);
    this.error.set("");
    try {
      const result = await this.api.tenant<{ category: Category }>(
        "admin/categories",
        "POST",
        {
          code: this.newCategoryCode.trim(),
          name: this.newCategoryName.trim(),
          isActive: true,
        },
      );
      if (!this.current()) return;
      this.categories.update((items) => [...items, result.category]);
      this.category = result.category.id;
      this.newCategoryCode = "";
      this.newCategoryName = "";
      this.categoryEditor = false;
      this.success.set("Catégorie de permis ajoutée.");
    } catch (e) {
      this.report(e);
    } finally {
      this.busy.set(false);
    }
  }
  private originalQuestions = "";
  private destroyed = false;
  private scope = "";
  private urls: string[] = [];
  async ngOnInit() {
    this.scope = `${this.api.slug}:${this.api.expectedUserId}`;
    await this.load();
  }
  private current() {
    return (
      !this.destroyed &&
      this.scope === `${this.api.slug}:${this.api.expectedUserId}` &&
      this.auth.role() === "admin"
    );
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.urls.forEach((u) => URL.revokeObjectURL(u));
  }
  async load() {
    this.loading.set(true);
    this.error.set("");
    try {
      const [catalogue, resources, quizzes] = await Promise.all([
        this.api.catalogue(true),
        this.api.adminResources(),
        this.api.adminQuizzes(),
      ]);
      if (!this.current()) return;
      this.categories.set(catalogue.categories);
      this.resources.set(resources.resources);
      this.quizzes.set(quizzes.quizzes);
    } catch (e) {
      this.report(e);
    } finally {
      this.loading.set(false);
    }
  }
  filteredResources() {
    return this.resources().filter(
      (r) => !this.filter || r.licence_category_id === this.filter,
    );
  }
  filteredQuizzes() {
    return this.quizzes().filter(
      (q) => !this.filter || q.licence_category_id === this.filter,
    );
  }
  categoryName(id: string) {
    return (
      this.categories().find((c) => c.id === id)?.name ||
      "Catégorie indisponible"
    );
  }
  switchTab(tab: "courses" | "quizzes") {
    if (this.busy()) return;
    this.tab = tab;
    this.editing = false;
    this.preview = false;
    this.error.set("");
    this.success.set("");
  }
  create() {
    this.id = "";
    this.title = "";
    this.category = this.filter || this.categories()[0]?.id || "";
    this.description = "";
    this.kind = "pdf";
    this.externalUrl = "";
    this.storagePath = null;
    this.file = null;
    this.fileName = "";
    this.duration = 20;
    this.questions = [];
    this.originalQuestions = "";
    this.preview = false;
    this.editing = true;
    this.error.set("");
    this.success.set("");
    if (this.tab === "quizzes") this.addQuestion();
  }
  editResource(r: AdminResource) {
    this.create();
    this.id = r.id;
    this.title = r.title;
    this.category = r.licence_category_id;
    this.description = r.description;
    this.kind = r.type;
    this.externalUrl = r.external_url || "";
    this.storagePath = r.storage_path;
  }
  editQuiz(q: AdminQuiz, copy = false) {
    this.create();
    this.id = copy ? "" : q.id;
    this.title = q.title + (copy ? " — copie" : "");
    this.category = q.licence_category_id;
    this.duration = q.duration_minutes;
    this.questions = [...q.questions]
      .sort((a, b) => a.position - b.position)
      .map((x) => ({
        ...(copy ? {} : { id: x.id }),
        body: x.body,
        options: [...x.options],
        correctIndex: x.correct_index,
        explanation: x.explanation || "",
        imageUrl: x.image_url,
      }));
    this.originalQuestions = copy ? "" : JSON.stringify(this.questions);
  }
  addQuestion() {
    if (this.questions.length < 100)
      this.questions.push({
        body: "",
        options: ["", ""],
        correctIndex: 0,
        explanation: "",
        imageUrl: null,
      });
  }
  removeOption(q: AuthorQuestion, i: number) {
    q.options.splice(i, 1);
    q.correctIndex =
      q.correctIndex === i
        ? 0
        : q.correctIndex > i
          ? q.correctIndex - 1
          : q.correctIndex;
  }
  changeKind() {
    this.file = null;
    this.fileName = "";
    this.storagePath = null;
    this.externalUrl = "";
  }
  selectFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.file = null;
    this.fileName = "";
    if (!file) return;
    const error = validateMaterial(file, this.kind);
    if (error) {
      this.error.set(error);
      input.value = "";
      return;
    }
    this.error.set("");
    this.file = file;
    this.fileName = file.name;
  }
  private valid(publish: boolean) {
    if (
      this.title.trim().length < 2 ||
      this.title.trim().length > 200 ||
      !this.category
    )
      return "Renseignez un titre (2 à 200 caractères) et une catégorie de permis.";
    if (this.tab === "courses") {
      if (this.kind === "link" && !/^https:\/\//.test(this.externalUrl))
        return "Saisissez un lien HTTPS valide.";
      if (this.kind !== "link" && !this.file && !this.storagePath)
        return "Sélectionnez un fichier avant d’enregistrer le cours.";
      if (this.file) return validateMaterial(this.file, this.kind);
    } else {
      if (
        !Number.isInteger(this.duration) ||
        this.duration < 1 ||
        this.duration > 240
      )
        return "La durée doit être comprise entre 1 et 240 minutes.";
      if (publish && !this.questions.length)
        return "Ajoutez au moins une question avant de publier.";
      if (!this.questions.every(questionValid))
        return "Complétez chaque question, ses choix et une réponse correcte. Les images doivent utiliser HTTPS.";
    }
    return null;
  }
  async save(publish: boolean) {
    if (this.busy() || !this.current()) return;
    const problem = this.valid(publish);
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      if (this.tab === "courses") {
        if (this.file) {
          this.storagePath = await this.api.uploadMaterial(
            this.file,
            this.kind,
          );
          this.file = null;
        }
        if (!this.current()) return;
        const result = await this.api.tenant<{ resource: AdminResource }>(
          "admin/resources" + (this.id ? "/" + this.id : ""),
          this.id ? "PATCH" : "POST",
          {
            licenceCategoryId: this.category,
            title: this.title.trim(),
            description: this.description,
            type: this.kind,
            storagePath: this.kind === "link" ? null : this.storagePath,
            externalUrl: this.kind === "link" ? this.externalUrl : null,
            isPublished: publish,
          },
        );
        this.id = result.resource.id;
      } else {
        const questionsChanged =
          !this.id || JSON.stringify(this.questions) !== this.originalQuestions;
        await this.api.tenant(
          "admin/quizzes" + (this.id ? "/" + this.id : ""),
          this.id ? "PATCH" : "POST",
          {
            licenceCategoryId: this.category,
            title: this.title.trim(),
            durationMinutes: this.duration,
            isPublished: publish,
            ...(questionsChanged
              ? {
                  questions: this.questions.map((q) => ({
                    ...q,
                    imageUrl: q.imageUrl || null,
                  })),
                }
              : {}),
          },
        );
      }
      if (!this.current()) return;
      this.editing = false;
      this.preview = false;
      await this.load();
      this.success.set(
        publish
          ? "Contenu enregistré et publié."
          : "Brouillon enregistré. Ce contenu n’est pas visible par les élèves.",
      );
    } catch (e) {
      this.report(e);
    } finally {
      this.busy.set(false);
    }
  }
  async publish(item: AdminResource | AdminQuiz) {
    if (this.busy() || !this.current()) return;
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      await this.api.tenant(
        `admin/${this.tab === "courses" ? "resources" : "quizzes"}/${item.id}`,
        "PATCH",
        { isPublished: !item.is_published },
      );
      if (!this.current()) return;
      await this.load();
      this.success.set(
        item.is_published
          ? "Contenu retiré de la publication. Les fichiers déjà téléchargés ne peuvent pas être effacés à distance."
          : "Contenu publié.",
      );
    } catch (e) {
      this.report(e);
    } finally {
      this.busy.set(false);
    }
  }
  async openResource(r?: AdminResource) {
    if (this.busy()) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    this.busy.set(true);
    this.error.set("");
    try {
      let url: string;
      if (!r && this.file) {
        url = URL.createObjectURL(this.file);
        this.urls.push(url);
      } else if (!r && this.kind === "link") {
        if (!/^https:\/\//.test(this.externalUrl)) throw new Error();
        url = this.externalUrl;
      } else {
        const id = r?.id || this.id;
        if (!id) throw new Error();
        url = (
          await this.api.tenant<{ url: string }>(`admin/resources/${id}/url`)
        ).url;
      }
      if (!this.current()) {
        tab?.close();
        return;
      }
      if (tab) tab.location.href = url;
      else
        this.error.set(
          "Autorisez les fenêtres surgissantes pour ouvrir le support.",
        );
    } catch (e) {
      tab?.close();
      this.report(e);
    } finally {
      this.busy.set(false);
    }
  }
  private report(error: unknown) {
    if (this.destroyed) return;
    const code = error instanceof RequestError ? error.code : "";
    const messages: Record<string, string> = {
      STORAGE_QUOTA_EXCEEDED:
        "L’espace de stockage de cette école est insuffisant. Contactez la direction avant de réessayer.",
      STORAGE_UNCONFIGURED:
        "Le stockage privé n’est pas configuré. Contactez le responsable technique.",
      STORAGE_UNAVAILABLE:
        "Le stockage est indisponible. Votre formulaire est conservé ; réessayez.",
      UPLOAD_FAILED:
        "Le transfert a échoué. Vérifiez la connexion et réessayez.",
      UPLOAD_NOT_FOUND:
        "Le fichier transféré est introuvable. Sélectionnez-le à nouveau.",
      INVALID_FILE_SIZE: "Le fichier doit contenir entre 1 octet et 25 Mo.",
      INVALID_FILE_TYPE:
        "Le contenu du fichier ne correspond pas au format autorisé.",
      QUIZ_HAS_ATTEMPTS:
        "Ce quiz a déjà été passé. Dupliquez-le pour modifier ses questions et préserver les résultats existants.",
      EMPTY_QUIZ: "Ajoutez au moins une question avant de publier.",
      VALIDATION_ERROR: "Vérifiez les champs du formulaire.",
    };
    this.error.set(
      messages[code] ||
        (error instanceof RequestError && [401, 403].includes(error.status)
          ? "Votre session ou vos droits ont changé. Reconnectez-vous à la bonne école."
          : "L’opération a échoué. Vérifiez votre connexion puis réessayez. Le formulaire est conservé."),
    );
  }
}
