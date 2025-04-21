import { Card, Drawer, Image, Segmented, Tag } from "antd";
import { FC, useMemo, useState } from "react";
import { useGradioClient } from "../../context";
import { useRequest } from "ahooks";

interface GalleryProps {
  galleryVisible: boolean;
  setGalleryVisible: (visible: boolean) => void;
  assembleFromGallery: (
    baseUrl: string,
    folder: string,
    files: string[]
  ) => void;
}

type GalleryData<KeyInIdList extends string = string> = {
  idList: KeyInIdList[];
  entities: {
    [key in KeyInIdList]: {
      id: string;
      dataset: string;
      subset: string;
      folder: string;
      files: string[];
    };
  };
};

const Gallery: FC<GalleryProps> = (props) => {
  const { galleryVisible, setGalleryVisible, assembleFromGallery } = props;
  const gradioClient = useGradioClient();

  const { data: galleryData, loading } = useRequest(
    async () => {
      const data = await fetch(`${gradioStaticFileUrl}/gallery.json`);
      return data.json() as Promise<GalleryData>;
    },
    {
      ready: galleryVisible,
    }
  );

  const datasets = useMemo(() => {
    if (!galleryData) {
      return [];
    }
    return Object.values(galleryData.entities).reduce((acc, { dataset }) => {
      if (!acc.includes(dataset)) {
        acc.push(dataset);
      }
      return acc;
    }, [] as string[]);
  }, [galleryData]);

  const gradioStaticFileUrl = useMemo(() => {
    return `${gradioClient.config?.root}${gradioClient.config?.api_prefix}/file=gallery`;
  }, [gradioClient]);

  const [selectedDataset, setSelectedDataset] = useState<string>("all");

  return (
    <Drawer
      title="Gallery"
      open={galleryVisible}
      onClose={() => setGalleryVisible(false)}
      placement="bottom"
      loading={loading}
      height="calc(100% - 88px)"
      styles={{ body: { padding: 0, paddingBlockEnd: 16 } }}
    >
      <div className="sticky -top-1 z-10 bg-white p-4">
        <Segmented
          options={[
            { label: "All", value: "all" },
            ...datasets.map((dataset) => ({
              label: dataset,
              value: dataset,
            })),
          ]}
          value={selectedDataset}
          onChange={(value) => setSelectedDataset(value)}
          keyParams="value"
        />
      </div>

      <div className="flex flex-wrap gap-4 px-4">
        {galleryData?.idList.map((id) =>
          selectedDataset === galleryData.entities[id].dataset ||
          selectedDataset === "all" ? (
            <Card
              key={id}
              className="w-48"
              cover={
                <div className="p-1 size-48">
                  <Image
                    height={184}
                    width={184}
                    alt={id}
                    preview={false}
                    src={`${gradioStaticFileUrl}/${galleryData.entities[id].folder}/preview.jpg`}
                    fallback={"/garf.png"}
                  />
                </div>
              }
              bordered
              styles={{
                body: {
                  padding: 8,
                },
              }}
              style={{
                cursor: "pointer",
              }}
              onClick={() =>
                assembleFromGallery(
                  gradioStaticFileUrl,
                  galleryData.entities[id].folder,
                  galleryData.entities[id].files
                )
              }
            >
              <div className="flex flex-wrap gap-y-1">
                <Tag color="blue">{galleryData.entities[id].dataset}</Tag>
                <Tag color="purple">{galleryData.entities[id].subset}</Tag>
                <Tag color="green">
                  {galleryData.entities[id].files.length} Parts
                </Tag>
              </div>
            </Card>
          ) : null
        )}
      </div>
    </Drawer>
  );
};

export default Gallery;
