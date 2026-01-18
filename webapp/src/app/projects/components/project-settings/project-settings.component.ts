import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { combineLatest, Observable, Subscription } from 'rxjs';
import { filter, tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { ClearMessages, DeleteProject, ProjectsState, ReloadCurrentProject, UpdateProject } from '../../stores/projects.state';
import { Locale } from '../../models/locale';
import { GetKnownLocales, TranslationsState } from '../../stores/translations.state';

@Component({
  selector: 'app-project-settings',
  templateUrl: './project-settings.component.html',
  styleUrls: ['./project-settings.component.css'],
})
export class ProjectSettingsComponent implements OnInit, OnDestroy {
  detailsForm = this.fb.group({
    name: ['', Validators.compose([Validators.required, Validators.pattern('.*[^ ].*')])],
    description: [''],
    fallbackLocale: ['en'],
    defaultExportFormat: ['jsonnested'],
  });

  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(TranslationsState.knownLocales)
  knownLocales$: Observable<Locale[]>;

  selectedFallbackLocale: Locale | undefined;

  @Select(ProjectsState.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projects.errorMessage)
  errorMessage$: Observable<string | undefined>;

  sub: Subscription;

  constructor(
    private fb: FormBuilder,
    private store: Store,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    this.store.dispatch(new ReloadCurrentProject());
    this.store.dispatch(new GetKnownLocales());

    this.sub = combineLatest([this.project$, this.knownLocales$])
      .pipe(
        filter(([project]) => !!project),
        tap(([project, knownLocales]) => {
          const p = project as Project;
          this.name.setValue(p.name);
          this.description.setValue(p.description);
          this.fallbackLocale.setValue(p.fallbackLocale || 'en');
          this.defaultExportFormat.setValue(p.defaultExportFormat || 'jsonnested');

          const code = (p.fallbackLocale || 'en').toLowerCase();
          this.selectedFallbackLocale = knownLocales.find(l => l.code.toLowerCase() === code) || this.selectedFallbackLocale;
        }),
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
    this.sub.unsubscribe();
  }

  get name() {
    return this.detailsForm.get('name');
  }

  get description() {
    return this.detailsForm.get('description');
  }

  get fallbackLocale() {
    return this.detailsForm.get('fallbackLocale');
  }

  get defaultExportFormat() {
    return this.detailsForm.get('defaultExportFormat');
  }

  onFallbackLocaleSelect(locale: Locale | undefined) {
    this.selectedFallbackLocale = locale;
    this.fallbackLocale.setValue(locale?.code || 'en');
  }

  onSubmit(id: string) {
    if (!this.detailsForm.valid) {
      return;
    }
    this.store.dispatch(new ClearMessages());
    this.store.dispatch(
      new UpdateProject(id, {
        name: this.name.value as string,
        description: this.description.value as string,
        fallbackLocale: this.fallbackLocale.value as string,
        defaultExportFormat: this.defaultExportFormat.value as string,
      }),
    );
  }

  onDelete(project: Project) {
    const ok = confirm(`Are you sure you want to delete the project: ${project.name}?`);
    if (!ok) {
      return;
    }
    const response = prompt(`Please type in the project name (${project.name}) to confirm delete.`);
    if (response !== project.name) {
      return;
    }
    this.store.dispatch(new DeleteProject(project.id));
  }

  currentUsage(project: Project): number {
    return project.termsCount * project.localesCount;
  }
}
