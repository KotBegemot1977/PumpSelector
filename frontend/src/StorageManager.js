import { CloudSqlAdapter } from './CloudSqlAdapter';
import { LocalJsonAdapter } from './LocalJsonAdapter';

class StorageManager {
    constructor() {
        this.cloudAdapter = new CloudSqlAdapter();
        this.localAdapter = new LocalJsonAdapter();

        // Default to cloud if token exists, otherwise local
        const savedMode = localStorage.getItem('storage_mode') || 'local';
        this.currentMode = savedMode;
        this.adapter = savedMode === 'cloud' ? this.cloudAdapter : this.localAdapter;
    }

    setMode(mode) {
        if (mode === 'cloud') {
            this.adapter = this.cloudAdapter;
        } else {
            this.adapter = this.localAdapter;
        }
        this.currentMode = mode;
        localStorage.setItem('storage_mode', mode);

        // Dispatch event for UI updates
        window.dispatchEvent(new CustomEvent('storage-mode-changed', { detail: { mode } }));
    }

    getAdapter() {
        return this.adapter;
    }

    isCloud() {
        return this.currentMode === 'cloud';
    }

    async getPumps() {
        return await this.adapter.getPumps();
    }

    async savePump(formData) {
        return await this.adapter.savePump(formData);
    }

    async deletePump(id) {
        return await this.adapter.deletePump(id);
    }
}

export const storageManager = new StorageManager();
