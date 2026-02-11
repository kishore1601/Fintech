import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const router = inject(Router);

    // Get token (check for window/localStorage availability for SSR safety, handled by Angular mostly but good practice)
    let token = null;
    if (typeof localStorage !== 'undefined') {
        token = localStorage.getItem('auth_token');
    }

    // Clone request with header if token exists
    if (token) {
        req = req.clone({
            setHeaders: {
                Authorization: `Bearer ${token}`
            }
        });
    }

    return next(req).pipe(
        catchError((err) => {
            // Login disabled - don't redirect on 401
            // if (err.status === 401) {
            //     if (typeof localStorage !== 'undefined') {
            //         localStorage.removeItem('auth_token');
            //     }
            //     router.navigate(['/login']);
            // }
            return throwError(() => err);
        })
    );
};
