import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { UsersService } from '@uniffy/proto/users/v1/users_pb';
import type { UserProfile } from '@uniffy/proto/users/v1/users_pb';

const usersClient = createClient(UsersService, unaryTransport);

export const usersApi = {
    updateMyProfile: async (fields: {
        pronouns?: string;
        accentColor?: string;
        fontFamily?: string;
    }): Promise<UserProfile> => {
        const response = await usersClient.updateMyProfile(fields);
        if (!response.user) throw new Error('user missing in UpdateMyProfile response');
        return response.user;
    },

    uploadAvatar: async (imageData: Uint8Array, filename: string): Promise<UserProfile> => {
        const response = await usersClient.uploadAvatar({ imageData: new Uint8Array(imageData), filename });
        if (!response.user) throw new Error('user missing in UploadAvatar response');
        return response.user;
    },

    deleteAvatar: async () => {
        return usersClient.deleteAvatar({});
    },
};
