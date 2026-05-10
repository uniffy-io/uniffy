/**
 * Users API Service
 *
 * ConnectRPC client for user profile and avatar operations.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { UsersService } from '@uniffy/proto/users/v1/users_connect';
import type { UserProfile } from '@uniffy/proto/users/v1/users_pb';

const usersClient = createClient(UsersService, transport);

export const usersApi = {
    /**
     * Get a user's profile by ID.
     */
    getUser: async (userId: string): Promise<UserProfile> => {
        const response = await usersClient.getUser({ userId });
        if (!response.user) throw new Error('user missing in GetUser response');
        return response.user;
    },

    /**
     * Upload a user avatar image.
     */
    uploadAvatar: async (imageData: Uint8Array, filename: string): Promise<UserProfile> => {
        const response = await usersClient.uploadAvatar({ imageData: new Uint8Array(imageData), filename });
        if (!response.user) throw new Error('user missing in UploadAvatar response');
        return response.user;
    },

    /**
     * Delete the current user's avatar.
     */
    deleteAvatar: async () => {
        return usersClient.deleteAvatar({});
    },
};
