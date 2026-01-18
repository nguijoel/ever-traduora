import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { BehaviorSubject, merge, Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { Locale } from '../../../projects/models/locale';

@Component({
  selector: 'app-select-locale',
  templateUrl: './select-locale.component.html',
  styleUrls: ['./select-locale.component.css'],
})
export class SelectLocaleComponent implements OnChanges {
  @Input()
  locales: Locale[] = [];

  @Input()
  exclude: Locale[] = [];

  @Input()
  limit = 5;

  @Input()
  loading = false;

  @Input()
  preserveHeight = false;

  @Input()
  multi = false;

  @Input()
  allowSelectAll = false;

  @Input()
  selectedLocales: Locale[] = [];

  @Output()
  selectLocale = new EventEmitter<Locale>();

  @Output()
  selectedLocalesChange = new EventEmitter<Locale[]>();

  selection: Locale | undefined;

  text$ = new BehaviorSubject<string>('');

  private ngChanged$ = new Subject<string>();
  private debouncedText$ = this.text$.pipe(
    debounceTime(50),
    map(text => text.trim().toLowerCase()),
    distinctUntilChanged(),
  );

  results$: Observable<Locale[]> = merge(this.debouncedText$, this.ngChanged$).pipe(
    map(text => {
      if (text === '') {
        return this.defaultLocales();
      }

      const tokens = text.toLowerCase().split(' ');

      return this.availableLocales()
        .filter(locale => {
          const localeSearchString = this.localeToSearchString(locale);
          for (const token of tokens) {
            if (localeSearchString.indexOf(token) === -1) {
              return false;
            }
          }
          return true;
        })
        .slice(0, this.limit);
    }),
  );

  ngOnChanges() {
    this.ngChanged$.next(this.text$.getValue());
  }

  select(locale: Locale) {
    if (this.multi) {
      this.toggleLocale(locale);
      return;
    }
    this.selection = locale;
    this.selectLocale.emit(locale);
  }

  onAllRowClick(event: Event) {
    if (this.isFromCheckbox(event)) {
      return;
    }
    this.toggleAll();
  }

  onRowClick(locale: Locale, event: Event) {
    if (this.isFromCheckbox(event)) {
      return;
    }
    this.select(locale);
  }

  private isFromCheckbox(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return false;
    }
    return !!target.closest('input[type="checkbox"], label.custom-control-label');
  }

  isAllSelected(): boolean {
    const all = this.availableLocales();
    return !!all.length && this.selectedLocales?.length === all.length;
  }

  toggleAll() {
    const all = this.availableLocales();
    if (this.isAllSelected()) {
      this.selectedLocales = [];
    } else {
      this.selectedLocales = [...all];
    }
    this.selectedLocalesChange.emit(this.selectedLocales);
  }

  isLocaleSelected(locale: Locale): boolean {
    return this.selectedLocales?.some(l => l.code === locale.code);
  }

  toggleLocale(locale: Locale) {
    if (this.isLocaleSelected(locale)) {
      this.selectedLocales = this.selectedLocales.filter(l => l.code !== locale.code);
    } else {
      this.selectedLocales = [...(this.selectedLocales || []), locale];
    }
    this.selectedLocalesChange.emit(this.selectedLocales);
  }

  defaultLocales(): Locale[] {
    const all = this.availableLocales();
    const res = all.filter(locale => locale.code.startsWith('de_') || locale.code.startsWith('en_'));
    if (res.length < this.limit) {
      return all.slice(0, this.limit);
    }
    return res.slice(0, this.limit);
  }

  availableLocales() {
    return this.locales.filter(v => !this.exclude.map(x => x.code).includes(v.code));
  }

  localeToSearchString(locale: Locale): string {
    return `${locale.language} ${locale.region} ${locale.code}`.toLowerCase();
  }
}
