import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private http = inject(HttpClient);
    private apiUrl = 'http://localhost:3000';

    // Auth State
    isLoggedIn = signal<boolean>(false);
    isLoading = signal<boolean>(false);

    constructor() {
        // Check local storage on init
        const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
        if (token) {
            this.isLoggedIn.set(true);
        }
    }

    login(username: string, password: string) {
        this.isLoading.set(true);
        return this.http.post<{ success: boolean, token: string }>(`${this.apiUrl}/login`, { username, password }).pipe(
            tap(res => {
                this.isLoading.set(false);
                if (res.success) {
                    this.isLoggedIn.set(true);
                    localStorage.setItem('auth_token', res.token);
                }
            }),
            catchError(err => {
                this.isLoading.set(false);
                console.error('Login failed', err);
                return of({ success: false, error: 'Invalid credentials' });
            })
        );
    }

    logout() {
        this.isLoggedIn.set(false);
        localStorage.removeItem('auth_token');
    }
}
