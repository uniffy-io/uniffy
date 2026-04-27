/**
 * Users API Service
 *
 * ConnectRPC client for user profile and avatar operations.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { UsersService } from '@uniffy/proto/users/v1/users_connect';

const usersClient = createClient(UsersService, transport);

export const usersApi = {
    /**
     * Get a user's profile by ID.
     */
    getUser: async (userId: string) => {
        return usersClient.getUser({ userId });
    },

    /**
     * Upload a user avatar image.
     */
    uploadAvatar: async (imageData: Uint8Array, filename: string) => {
        return usersClient.uploadAvatar({ imageData: new Uint8Array(imageData), filename });
    },

    /**
     * Delete the current user's avatar.
     */
    deleteAvatar: async () => {
        return usersClient.deleteAvatar({});
    },
};
