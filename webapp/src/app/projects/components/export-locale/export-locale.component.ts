import { Component, Input, OnChanges } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { errorToMessage } from '../../../shared/util/api-error';
import { ExportFormat, EXPORT_FORMATS } from '../../models/export';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
import { ExportService } from '../../services/export.service';
import { PushService } from '../../services/push.service';

@Component({
  selector: 'app-export-locale',
  templateUrl: './export-locale.component.html',
  styleUrls: ['./export-locale.component.css'],
})
export class ExportLocaleComponent implements OnChanges {
  @Input()
  project: Project;

  @Input()
  locales: Locale[];

  @Input()
  loading = false;

  selectedLocales: Locale[] = [];
  selectedFallbackLocale?: Locale;
  selectedFormat: ExportFormat;
  availableFormats = EXPORT_FORMATS;
  untranslated = false;

  errorMessage: string;

  constructor(
    private exportService: ExportService,
    private pushService: PushService) {}

  ngOnChanges() {
    if (!this.selectedFormat) {
      const defaultFormatCode = this.project?.defaultExportFormat || 'jsonnested';
      this.selectedFormat = this.availableFormats.find(f => f.code === defaultFormatCode) || this.availableFormats.find(f => f.code === 'jsonnested');
    }

    if (!this.selectedFallbackLocale && this.locales?.length) {
      const projectFallback = this.project?.fallbackLocale;
      const fallback = projectFallback
        ? this.locales.find(l => l.code?.toLowerCase() === projectFallback.toLowerCase())
        : undefined;

      this.selectedFallbackLocale = fallback || this.locales.find(l => l.code?.toLowerCase() === 'en' || l.code?.toLowerCase().startsWith('en')) || undefined;
    }
  }

  validInputs() {
    return !!this.selectedFormat && !!this.selectedLocales?.length;
  }

  isAllSelected(): boolean {
    return !!this.locales?.length && this.selectedLocales?.length === this.locales.length;
  }

  toggleAllLocales() {
    if (this.isAllSelected()) {
      this.selectedLocales = [];
    } else {
      this.selectedLocales = [...(this.locales || [])];
    }
  }

  isLocaleSelected(locale: Locale): boolean {
    return this.selectedLocales.some(l => l.code === locale.code);
  }

  toggleLocale(locale: Locale) {
    if (this.isLocaleSelected(locale)) {
      this.selectedLocales = this.selectedLocales.filter(l => l.code !== locale.code);
    } else {
      this.selectedLocales = [...this.selectedLocales, locale];
    }
  }

  selectedLocalesTitle(): string {
    if (!this.selectedLocales?.length) {
      return 'None';
    }
    if (this.isAllSelected()) {
      return 'All';
    }
    return this.selectedLocales.map(l => l.language).join(', ');
  }

  selectedLocalesCountLabel(): string {
    if (!this.selectedLocales?.length) {
      return '0';
    }
    if (this.isAllSelected()) {
      return 'All';
    }
    return `${this.selectedLocales.length}`;
  }

  pushButtonLabel(): string {
    if (!this.selectedLocales?.length) {
      return 'Push';
    }
    return `Push (${this.selectedLocalesCountLabel()})`;
  }

  downloadButtonLabel(): string {
    if (!this.selectedLocales?.length) {
      return 'Download';
    }
    return `Download (${this.selectedLocalesCountLabel()})`;
  }

  selectFallbackLocale(locale: Locale) {
    this.selectedFallbackLocale = locale;
  }

  async export() {
    if (!this.validInputs()) {
      return;
    }

    this.errorMessage = undefined;
    this.loading = true;

    const localesToExport = this.isAllSelected() ? (this.locales || []) : (this.selectedLocales || []);

    try {
      for (const locale of localesToExport) {
        await this.exportService
          .exportAndDownload(this.project.id, locale.code, this.selectedFormat, this.untranslated, this.selectedFallbackLocale?.code)
          .pipe(
            catchError(error => {
              console.error(error);
              this.errorMessage = errorToMessage(error, 'ExportLocale');
              return throwError(error);
            }),
          )
          .toPromise();
      }
    } finally {
      this.loading = false;
    }
  }


  
  /**
   * ONTOO Extensions
  */

  validPushInputs() {
    return !!this.selectedFormat && !!this.selectedLocales?.length;
  }

  async push() {

    if (!this.validPushInputs()) {
      return;
    }

    this.errorMessage = undefined;
    this.loading = true;

    try {
      const localeCodes = this.isAllSelected() ? undefined : (this.selectedLocales || []).map(l => l.code);

      await this.pushService
        .push(this.project.id, this.selectedFormat.code, this.untranslated, this.selectedFallbackLocale?.code, undefined, localeCodes)
        .pipe(
          catchError(error => {
            console.error(error);
            this.errorMessage = errorToMessage(error, 'ExportLocale');
            return throwError(error);
          }),
        )
        .toPromise();
    } finally {
      this.loading = false;
    }
  }
}
