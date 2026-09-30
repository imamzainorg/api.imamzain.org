import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

describe('PostsController', () => {
  const service = {
    trackView: jest.fn().mockResolvedValue({ message: 'View tracked', data: null }),
    togglePublish: jest.fn().mockResolvedValue({ message: 'Post published', data: {} }),
  } as unknown as jest.Mocked<PostsService>;
  const controller = new PostsController(service);

  afterEach(() => jest.clearAllMocks());

  describe('trackView', () => {
    it('hands the client IP to the service so it can de-duplicate the view', async () => {
      await controller.trackView('post-1', { ip: '203.0.113.7' } as any);

      expect(service.trackView).toHaveBeenCalledWith('post-1', '203.0.113.7');
    });

    it('passes undefined when Express resolved no IP (the service then always counts)', async () => {
      await controller.trackView('post-1', {} as any);

      expect(service.trackView).toHaveBeenCalledWith('post-1', undefined);
    });
  });

  describe('togglePublish', () => {
    it('keeps forwarding (id, dto, actor id, lang) unchanged', async () => {
      await controller.togglePublish('post-1', { is_published: true }, { id: 'user-1' } as any, 'ar');

      expect(service.togglePublish).toHaveBeenCalledWith('post-1', { is_published: true }, 'user-1', 'ar');
    });
  });
});
