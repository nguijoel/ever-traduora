import { Component, Input } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { Locale } from '../../../projects/models/locale';

@Component({
  selector: 'app-country-flag',
  templateUrl: './country-flag.component.html',
  styleUrls: ['./country-flag.component.css'],
})
export class CountryFlagComponent {
  @Input()
  locale: Locale;

  useCdnFlags(): boolean {
    return environment.useCdnFlags === true;
  }

  countryCode(): string | undefined {
    if (!this.locale?.code) {
      return undefined;
    }
    return this.localeIconCode(this.locale.code);
  }

  flagUrl(): string | undefined {
    const cc = this.countryCode();
    if (!cc) {
      return undefined;
    }
    const template = environment.cdnFlagUrlTemplate || '';
    if (!template) {
      return undefined;
    }
    return template.replace('{cc}', cc.toLowerCase());
  }

  localeIconCode(code: string): string | undefined {
    const match = code.match('.*_([A-Z]{2})$');
    if (match) {
      return match[1].toLowerCase();
    }
    // Default codes
    switch (code) {
      case 'en':
        return 'gb';
      case 'de':
        return 'de';
      case 'es':
        return 'es';
      case 'fr':
        return 'fr';
      case 'nl':
        return 'nl';
    }
    return undefined;
  }
}
