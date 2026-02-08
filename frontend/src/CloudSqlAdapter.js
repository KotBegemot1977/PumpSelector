import { authManager } from './AuthManager';

export class CloudSqlAdapter {
    constructor() {
        this.name = 'Командный (SQL)';
        this.type = 'cloud';
    }

    async getPumps() {
        const response = await fetch('/api/pumps', {
            headers: authManager.getAuthHeader()
        });
        if (!response.ok) {
            if (response.status === 401) throw new Error('401 Unauthorized');
            throw new Error(`Failed to fetch pumps: ${response.status}`);
        }
        return await response.json();
    }

    async savePump(formData) {
        // formData is already prepared by the UI layer
        const response = await fetch('/api/calculate', {
            method: 'POST',
            body: formData,
            headers: authManager.getAuthHeader()
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to save pump to cloud');
        }
        return await response.json();
    }

    async deletePump(id) {
        const response = await fetch(`/api/pumps/${id}`, {
            method: 'DELETE',
            headers: authManager.getAuthHeader()
        });
        if (!response.ok) throw new Error('Failed to delete pump from cloud');
        return await response.json();
    }

    async getDrawing(pump) {
        // Main.js passes the entire pump object
        // Extract the path from the object, supporting direct string path for backward compatibility
        const path = (typeof pump === 'object' && pump !== null) ? (pump.drawing_path || pump.drawing_filename) : pump;

        if (!path || typeof path !== 'string') return null;

        // If it's a relative path starting with /api, use it directly
        // Otherwise it might be a filename, we need to know how to fetch it.
        // Assuming drawing_path is the full URL from backend (e.g. /api/drawings/123/file.pdf)
        // If path doesn't start with / or http, assume it's a filename in /uploads/
        if (!path.startsWith('/') && !path.startsWith('http')) {
            path = '/uploads/' + path;
        }

        const response = await fetch(path, {
            headers: authManager.getAuthHeader()
        });
        if (!response.ok) throw new Error('Failed to fetch drawing');
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    }
}
