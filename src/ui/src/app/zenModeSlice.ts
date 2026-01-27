import { createSlice } from '@reduxjs/toolkit';

interface ZenModeState {
    isActive: boolean;
}

const initialState: ZenModeState = {
    isActive: false,
};

const zenModeSlice = createSlice({
    name: 'zenMode',
    initialState,
    reducers: {
        toggleZenMode: (state) => {
            state.isActive = !state.isActive;
        },
    },
});

export const { toggleZenMode } = zenModeSlice.actions;

export default zenModeSlice.reducer;
