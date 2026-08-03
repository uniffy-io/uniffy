export { peopleApi } from '@/features/people/api/peopleApi';
export { peopleReducer, clearPeople } from '@/features/people/store/peopleSlice';
export type { PeopleState } from '@/features/people/store/peopleSlice';
export {
    fetchOrgChartThunk,
    fetchPersonThunk,
    fetchProfilePolicyThunk,
    fetchTeamThunk,
    setManagerThunk,
    updateMyProfileThunk,
    updatePersonProfileThunk,
} from '@/features/people/store/peopleThunks';
export type {
    SerializedOrgChartNode,
    SerializedPersonProfile,
    SerializedProfileLink,
    SerializedTeamNode,
    SerializedTeamRef,
} from '@/features/people/store/peopleThunks';
