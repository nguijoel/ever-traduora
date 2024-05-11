/**
 * ONTOO extended service
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

  push(projectId: string, format: string, untranslated: boolean, fallbackLocale?: string, localeCode?: string): Observable<any> {

    const url = new URL(`${this.endpoint}/projects/${projectId}/push?locale=${localeCode || 'xx' }&format=${format}&untranslated=${untranslated}`);

    if (fallbackLocale) {
      url.searchParams.append('fallbackLocale', fallbackLocale);
    }

    return this.http.get(url.toString());
  }
}
