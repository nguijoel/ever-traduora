/**
 * ONTOO:SERVICES - PostService
 */
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class PushService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  push(
    projectId: string,
    format: string,
    untranslated: boolean,
    fallbackLocale?: string,
    localeCode?: string,
    localeCodes?: string[],
  ): Observable<any> {

    const localesParam = (localeCodes || []).map(c => String(c).trim()).filter(Boolean).join(',');
    const effectiveLocale = localesParam ? 'xx' : (localeCode || 'xx');
    const url = new URL(`${this.endpoint}/projects/${projectId}/push?locale=${effectiveLocale}&format=${format}&untranslated=${untranslated}`);

    if (localesParam) {
      url.searchParams.append('locales', localesParam);
    }

    if (fallbackLocale) {
      url.searchParams.append('fallbackLocale', fallbackLocale);
    }

    return this.http.post(url.toString(), {});
  }
}
